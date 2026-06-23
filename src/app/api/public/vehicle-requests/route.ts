import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getOverlappingAssignments,
  insertVehicleBooking,
  setBookingVehicles,
  setBookingDrivers,
} from "@/services/vehicles";
import { sendVehicleRequestReceived } from "@/lib/email/send-vehicle-request";

// Public, no-login vehicle request intake. Reached via the pasteable
// /request-vehicle/<slug> link. Runs entirely through the service-role admin
// client (bypasses RLS), gated only by the active slug + the on/off toggle in
// vehicle_request_link_settings. Covered by the "/api/public" middleware
// allowlist.

type DriverInput = {
  name?: string;
  phone?: string;
  has_sa_license?: boolean;
  is_first_time?: boolean;
};

type CreateBody = {
  slug?: string;
  // Honeypot — real users never see/fill this; bots do.
  company?: string;
  booking_name?: string;
  point_person?: string;
  purpose?: string;
  purpose_note?: string;
  requester_name?: string;
  requester_email?: string;
  requester_phone?: string;
  num_people?: number;
  checkout_date?: string;
  return_date?: string;
  vehicle_ids?: string[];
  drivers?: DriverInput[];
  notes?: string;
};

const PURPOSES = [
  "international_team",
  "ministry",
  "airport_run",
  "personal",
  "other",
];

// Per-IP throttle for the public endpoint.
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX = 5; // submissions per IP per window

function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    null
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getActiveLink(supabase: any, slug: string | null) {
  if (!slug) return null;
  const { data } = await supabase
    .from("vehicle_request_link_settings")
    .select("slug, enabled")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

// GET /api/public/vehicle-requests?slug=&from=&to=
// Slug-gated availability probe so the public form can grey out booked
// vehicles without exposing the authed dry-run endpoint.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const from = nn(searchParams.get("from"));
  const to = nn(searchParams.get("to"));

  const supabase = createAdminClient();
  const link = await getActiveLink(supabase, slug);
  if (!link || !link.enabled) {
    return NextResponse.json({ error: "Link not available" }, { status: 404 });
  }
  if (!from || !to || to < from) {
    return NextResponse.json({ unavailableVehicleIds: [] });
  }

  const overlapping = await getOverlappingAssignments(supabase, from, to);
  const unavailableVehicleIds = Array.from(
    new Set(overlapping.map((a) => a.vehicle_id))
  );
  return NextResponse.json({ unavailableVehicleIds });
}

// POST /api/public/vehicle-requests — create a public vehicle request.
export async function POST(request: Request) {
  const supabase = createAdminClient();

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const link = await getActiveLink(supabase, nn(body.slug));
  if (!link) {
    return NextResponse.json({ error: "This link is not valid" }, { status: 404 });
  }
  if (!link.enabled) {
    return NextResponse.json(
      { error: "This request link is currently closed" },
      { status: 403 }
    );
  }

  // Honeypot — silently accept (look successful) but persist nothing.
  if (nn(body.company)) {
    return NextResponse.json({ ok: true });
  }

  const ip = clientIp(request);

  // Per-IP rate limit over the recent window.
  if (ip) {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from("vehicle_bookings")
      .select("id", { count: "exact", head: true })
      .eq("submitted_ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_MAX) {
      return NextResponse.json(
        { error: "Too many requests just now — please try again in a few minutes." },
        { status: 429 }
      );
    }
  }

  const requesterName = nn(body.requester_name);
  const requesterEmail = nn(body.requester_email);
  const checkout = nn(body.checkout_date);
  const ret = nn(body.return_date);
  const purpose = PURPOSES.includes(body.purpose ?? "") ? body.purpose! : "ministry";

  if (!requesterName) {
    return NextResponse.json({ error: "Please enter your name" }, { status: 400 });
  }
  if (!requesterEmail || !isEmail(requesterEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email address" },
      { status: 400 }
    );
  }
  if (!checkout || !ret) {
    return NextResponse.json(
      { error: "Collection and return dates are required" },
      { status: 400 }
    );
  }
  if (ret < checkout) {
    return NextResponse.json(
      { error: "The return date must be on or after the collection date" },
      { status: 400 }
    );
  }

  // Public submitters may not give a separate "booking name" — fall back to
  // their own name so the NOT NULL column always has a sensible label.
  // (requesterName is non-null past the guard above.)
  const bookingName: string = nn(body.booking_name) ?? requesterName;

  const requestedIds = Array.isArray(body.vehicle_ids)
    ? body.vehicle_ids.filter((v): v is string => typeof v === "string")
    : [];

  // Hard block: a chosen vehicle can't overlap an existing live booking.
  const overlapping = await getOverlappingAssignments(supabase, checkout, ret);
  const unavailableIds = new Set(overlapping.map((a) => a.vehicle_id));
  const clashing = requestedIds.filter((id) => unavailableIds.has(id));
  if (clashing.length > 0) {
    return NextResponse.json(
      {
        error:
          "One or more of the vehicles you picked is already booked for those dates. Please choose different vehicles or adjust the dates.",
        clashingVehicleIds: clashing,
      },
      { status: 409 }
    );
  }

  const { data: booking, error } = await insertVehicleBooking(supabase, {
    booking_name: bookingName,
    point_person: nn(body.point_person),
    purpose,
    purpose_note: purpose === "other" ? nn(body.purpose_note) : null,
    requester_name: requesterName,
    requester_email: requesterEmail,
    requester_phone: nn(body.requester_phone),
    num_people:
      typeof body.num_people === "number" && body.num_people > 0
        ? body.num_people
        : null,
    checkout_date: checkout,
    return_date: ret,
    status: "pending",
    source: "public",
    submitted_ip: ip,
    notes: nn(body.notes),
    requested_by: null,
  });

  if (error || !booking) {
    return NextResponse.json(
      { error: error?.message ?? "Could not submit your request" },
      { status: 500 }
    );
  }

  if (requestedIds.length > 0) {
    await setBookingVehicles(supabase, booking.id, requestedIds);
  }

  const drivers = (body.drivers ?? [])
    .map((d) => ({
      name: nn(d.name),
      phone: nn(d.phone),
      has_sa_license: !!d.has_sa_license,
      is_first_time: !!d.is_first_time,
      driving_test_status: d.is_first_time ? "pending" : "not_required",
    }))
    .filter((d) => d.name);
  if (drivers.length > 0) {
    await setBookingDrivers(supabase, booking.id, drivers as Record<string, unknown>[]);
  }

  // Confirmation email — best-effort; a mail failure never fails the request.
  let vehicleNames: string[] = [];
  if (requestedIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vrows } = await (supabase as any)
      .from("vehicles")
      .select("name")
      .in("id", requestedIds);
    vehicleNames = ((vrows ?? []) as { name: string }[]).map((v) => v.name);
  }
  await sendVehicleRequestReceived({
    email: requesterEmail,
    requesterName,
    bookingName,
    checkoutDate: checkout,
    returnDate: ret,
    vehicleNames,
  });

  return NextResponse.json({ ok: true, bookingId: booking.id });
}
