import { after, NextResponse } from "next/server";
import { notifyVehicleSlack } from "@/lib/vehicles/slack-alerts";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getVehicleBookingOwner,
  insertAgreement,
} from "@/services/vehicles";
import { VEHICLE_POLICY_VERSION } from "@/lib/vehicles/policy";

function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

// POST /api/vehicles/agreements — record acceptance (e-signature) of the
// FFSA Vehicle Usage Policy against a booking.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookingId = nn(body.vehicle_booking_id);
  const signerName = nn(body.signer_name);
  const typedSignature = nn(body.typed_signature);
  if (!bookingId) return NextResponse.json({ error: "vehicle_booking_id is required" }, { status: 400 });
  if (!signerName) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!typedSignature) return NextResponse.json({ error: "Please type your signature." }, { status: 400 });
  if (body.agreed !== true) {
    return NextResponse.json({ error: "You must agree to the policy to sign." }, { status: 400 });
  }

  const access = await getVehicleAccess(supabase, user.id);
  const { data: booking } = await getVehicleBookingOwner(supabase, bookingId);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const isManager = access.isAdmin || access.canApprove || access.canManage;
  if (!isManager && booking.requested_by !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;

  const { data, error } = await insertAgreement(supabase, {
    vehicle_booking_id: bookingId,
    signer_name: signerName,
    signer_email: nn(body.signer_email),
    typed_signature: typedSignature,
    policy_version: VEHICLE_POLICY_VERSION,
    agreed: true,
    ip_address: ip,
    signed_by: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  after(() => notifyVehicleSlack("signed", bookingId, { signerName }));
  return NextResponse.json({ ok: true, agreement: data });
}
