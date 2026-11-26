import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { rentalMessagesOn, runRentalMessages, type RentalPhase } from "@/lib/vehicles/rental-schedule";
import { notifyDueBack } from "@/lib/vehicles/rental-return";

const sastToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

/** Shared by the two crons (pick-up 06:30 SAST, return 07:00 SAST). Off until
 *  VEHICLE_RENTAL_MESSAGES_ENABLED is set in production. */
export async function rentalCron(request: Request, phase: RentalPhase): Promise<NextResponse> {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rentalMessagesOn()) return NextResponse.json({ ok: true, skipped: "VEHICLE_RENTAL_MESSAGES_ENABLED is off" });
  try {
    const admin = createAdminClient();
    const out = await runRentalMessages(admin, {
      today: sastToday(),
      phase,
      notifyDueBack: phase === "return" ? (id) => notifyDueBack(id, admin) : undefined,
    });
    return NextResponse.json({ ok: true, phase, sent: out.sent.length, dueBack: out.dueBack.length, results: out.sent });
  } catch (err) {
    console.error(`[cron/vehicle-rental-${phase}] failed`, err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
