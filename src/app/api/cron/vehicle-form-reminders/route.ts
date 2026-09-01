import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendVehicleFormReminder } from "@/lib/email/send-vehicle-request";

export const maxDuration = 60;

// GET /api/cron/vehicle-form-reminders — daily Vercel cron, 22:00 UTC.
//
// 22:00 UTC is 00:00 SAST, so this runs at the very start of the South African
// day. On the morning a vehicle is collected the requester gets the sign-out
// form; on the day it is due back, the sign-in form. These replaced the two
// Google Forms the coordinator used to send by hand.
//
// Send-once is enforced by collection_email_sent_at / return_email_sent_at
// (migration 197), stamped only on a successful or suppressed send — a hard
// provider error deliberately leaves the stamp null so tomorrow retries.
// Mirrors the auth + stamp shape of school-reminders.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const CAP = 200;

type Stage = {
  kind: "collection" | "return";
  dateColumn: "checkout_date" | "return_date";
  stampColumn: "collection_email_sent_at" | "return_email_sent_at";
};

const STAGES: Stage[] = [
  { kind: "collection", dateColumn: "checkout_date", stampColumn: "collection_email_sent_at" },
  { kind: "return", dateColumn: "return_date", stampColumn: "return_email_sent_at" },
];

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin: Client = createAdminClient();
  // Today in SAST (UTC+2). At 22:00 UTC this is already tomorrow's date in
  // Johannesburg, which is exactly the day whose forms we want to send.
  const today = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);

  let sent = 0;
  let skipped = 0;

  for (const stage of STAGES) {
    const { data: due, error } = await admin
      .from("vehicle_bookings")
      .select(
        "id, booking_name, requester_name, requester_email, checkout_date, return_date, assignments:vehicle_booking_assignments(vehicle:vehicles(name, registration_plate))"
      )
      .eq("status", "approved")
      // `lte`, not `eq`: a booking approved after midnight on its own
      // collection day would never match an equality check and would silently
      // never be sent.
      .lte(stage.dateColumn, today)
      .is(stage.stampColumn, null)
      .limit(CAP);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const b of due ?? []) {
      if (!b.requester_email) {
        skipped += 1;
        continue;
      }

      const vehicleLabel =
        (b.assignments ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => {
            const v = Array.isArray(a.vehicle) ? a.vehicle[0] : a.vehicle;
            if (!v) return null;
            return v.registration_plate ? `${v.name} — ${v.registration_plate}` : v.name;
          })
          .filter(Boolean)
          .join(", ") || null;

      const stamp = () =>
        admin
          .from("vehicle_bookings")
          .update({ [stage.stampColumn]: new Date().toISOString() })
          .eq("id", b.id);

      try {
        const result = await sendVehicleFormReminder({
          email: b.requester_email,
          requesterName: b.requester_name,
          bookingId: b.id,
          bookingName: b.booking_name,
          kind: stage.kind,
          checkoutDate: b.checkout_date,
          returnDate: b.return_date,
          vehicleLabel,
        });

        if (result.ok) {
          sent += 1;
          await stamp();
        } else {
          skipped += 1;
          // A suppressed address will never deliver — stamp it so we stop
          // retrying. Any other failure is left for tomorrow.
          if (result.suppressed) await stamp();
        }
      } catch {
        skipped += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, today, sent, skipped });
}
