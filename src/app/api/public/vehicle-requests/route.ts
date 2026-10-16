import { after, NextResponse } from "next/server";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveVehicleRequestLink,
  getOverlappingAssignments,
  insertVehicleBooking,
  setBookingVehicles,
  setBookingDrivers,
  setDriverLicense,
} from "@/services/vehicles";
import { notifyVehicleManagers } from "@/lib/email/send-vehicle-request";

/**
 * Vehicle requests from people with no Hub account.
 *
 * Unauthenticated by necessity — the whole point is that the requester has no
 * login — so the token in the body is the only thing standing between this
 * endpoint and the open internet. Two consequences shape the code:
 *
 *  - Files are accepted ONLY as part of a valid submission, in this one
 *    multipart request. A standalone public upload endpoint would be an open
 *    file drop.
 *  - Everything the request can set is enumerated below. It cannot choose a
 *    status, a requester id, or a price; the booking always lands as
 *    `pending` / `source: 'public'` for a human to review.
 */

const BUCKET = "vehicle-inspections";
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DRIVERS = 6;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const PURPOSES = ["international_team", "ministry", "airport_run", "personal", "other"];

/**
 * Crude per-IP throttle.
 *
 * In-memory, so it is per serverless instance and resets on redeploy — it
 * slows a casual flood, it does not stop a determined one. The token is the
 * real protection; if the form is ever abused, rotate it. A proper limiter
 * would need shared state (Upstash or a table) and is worth doing if this
 * link ever goes anywhere public.
 */
const RATE = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hit = RATE.get(ip);
  if (!hit || now > hit.resetAt) {
    RATE.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.count += 1;
  return hit.count > MAX_PER_WINDOW;
}

function nn(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests from this connection. Please try again later." },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const admin = createAdminClient();
  const token = String(form.get("token") ?? "").trim();
  const link = await resolveVehicleRequestLink(admin, token);
  if (!link) {
    return NextResponse.json(
      { error: "This request link is no longer active. Ask your FFSA contact for a new one." },
      { status: 404 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const bookingName = nn(payload.booking_name);
  const checkout = nn(payload.checkout_date);
  const ret = nn(payload.return_date);
  const requesterName = nn(payload.requester_name);
  const requesterEmail = nn(payload.requester_email);

  if (!bookingName) {
    return NextResponse.json({ error: "Please give the booking a name." }, { status: 400 });
  }
  if (!nn(payload.point_person)) {
    return NextResponse.json({ error: "Please give the point person for this booking." }, { status: 400 });
  }
  if (!requesterName || !requesterEmail) {
    return NextResponse.json(
      { error: "Please give your name and email address." },
      { status: 400 }
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requesterEmail)) {
    return NextResponse.json({ error: "Please check your email address." }, { status: 400 });
  }
  if (!checkout || !ret) {
    return NextResponse.json(
      { error: "Please choose collection and return dates." },
      { status: 400 }
    );
  }
  if (ret < checkout) {
    return NextResponse.json(
      { error: "The return date must be on or after the collection date." },
      { status: 400 }
    );
  }
  // No back-dating: a public form has no business creating history.
  if (checkout < new Date().toISOString().slice(0, 10)) {
    return NextResponse.json(
      { error: "The collection date can't be in the past." },
      { status: 400 }
    );
  }

  const purpose = PURPOSES.includes(String(payload.purpose ?? ""))
    ? String(payload.purpose)
    : "ministry";

  const requestedIds = Array.isArray(payload.vehicle_ids)
    ? (payload.vehicle_ids as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  // Same clash rule as the internal form — a public requester must not be
  // able to double-book a vehicle.
  const overlapping = await getOverlappingAssignments(admin, checkout, ret);
  const unavailable = new Set(overlapping.map((a) => a.vehicle_id));
  const clashing = requestedIds.filter((id) => unavailable.has(id));
  if (clashing.length > 0) {
    return NextResponse.json(
      {
        error:
          "One or more of the vehicles you picked has just been booked for those dates. Please choose another.",
        clashingVehicleIds: clashing,
      },
      { status: 409 }
    );
  }

  const rawDrivers = Array.isArray(payload.drivers) ? payload.drivers : [];
  const drivers = rawDrivers
    .slice(0, MAX_DRIVERS)
    .map((d) => {
      const row = d as Record<string, unknown>;
      return {
        // Public requesters are outsiders by definition — never linked to a
        // Hub user, whatever the body claims.
        user_id: null,
        name: nn(row.name),
        phone: nn(row.phone),
        has_sa_license: !!row.has_sa_license,
        is_first_time: true, // unknown to us: a manager confirms before approval
        driving_test_status: "pending",
      };
    })
    .filter((d) => d.name);

  if (drivers.length === 0) {
    return NextResponse.json(
      { error: "Please list at least one driver." },
      { status: 400 }
    );
  }

  // Every driver's licence AND passport page photo must come with the
  // request (licence_<i> / passport_<i>, index-matched to the drivers). Checked
  // before anything is written, so a refused request leaves nothing behind.
  const usable = (f: FormDataEntryValue | null): f is File =>
    f instanceof File && ALLOWED.includes(f.type) && f.size <= MAX_BYTES;
  for (let i = 0; i < drivers.length; i++) {
    if (!usable(form.get(`licence_${i}`))) {
      return NextResponse.json(
        { error: `Please attach ${drivers[i].name}'s licence photo (image or PDF, up to 10 MB).` },
        { status: 400 }
      );
    }
    if (!usable(form.get(`passport_${i}`))) {
      return NextResponse.json(
        { error: `Please attach ${drivers[i].name}'s passport page photo (image or PDF, up to 10 MB).` },
        { status: 400 }
      );
    }
  }

  const { data: booking, error } = await insertVehicleBooking(admin, {
    booking_name: bookingName,
    point_person: nn(payload.point_person),
    purpose,
    purpose_note: purpose === "other" ? nn(payload.purpose_note) : null,
    requester_name: requesterName,
    requester_email: requesterEmail,
    requester_phone: nn(payload.requester_phone),
    num_people:
      typeof payload.num_people === "number" && payload.num_people > 0
        ? payload.num_people
        : null,
    checkout_date: checkout,
    return_date: ret,
    home_country: nn(payload.home_country),
    status: "pending",
    source: "public",
    notes: nn(payload.notes),
    requested_by: null,
  });

  if (error || !booking) {
    return NextResponse.json(
      { error: error?.message ?? "Could not submit your request." },
      { status: 500 }
    );
  }

  if (requestedIds.length > 0) {
    await setBookingVehicles(admin, booking.id, requestedIds);
  }

  const { data: created } = await setBookingDrivers(admin, booking.id, drivers);

  // Licences / passport photos arrive as licence_<i> / passport_<i>, matching
  // the driver order. A failed storage write must not lose the request: the
  // booking page can take the file later, and approval waits for it.
  await Promise.all(
    created.flatMap((driver, i) =>
      (["licence", "passport"] as const).map(async (kind) => {
        const file = form.get(`${kind}_${i}`);
        if (!usable(file)) return;
        const folder = kind === "licence" ? "licenses" : "passports";
        const path = `${folder}/${booking.id}/${driver.id}/${Date.now()}.${EXT[file.type] ?? "bin"}`;
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) return;
        const now = new Date().toISOString();
        await setDriverLicense(
          admin,
          driver.id,
          kind === "licence"
            ? { license_file_url: path, license_file_name: file.name, license_uploaded_at: now, license_uploaded_by: null }
            : { passport_file_url: path, passport_file_name: file.name, passport_uploaded_at: now }
        );
      })
    )
  );

  await notifyVehicleManagers({
    event: "requested",
    bookingId: booking.id,
    bookingName,
    requesterName,
    checkoutDate: checkout,
    returnDate: ret,
  });

  // Confirm receipt to the person who booked (Slack DM + email).
  after(() => notifyVehicleRequester({ bookingId: booking.id, kind: "submitted" }).then(() => undefined));

  return NextResponse.json({ ok: true });
}
