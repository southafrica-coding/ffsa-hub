import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";
import { decideVehicleBooking, VEHICLE_DECISIONS, type VehicleDecision } from "@/services/vehicle-decisions";
import { refreshVehicleRequestAlerts } from "@/lib/vehicles/slack-alerts";

type DecisionBody = { decision?: string; note?: string };

// POST /api/vehicles/bookings/[id]/decision — approve / deny / complete.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canApprove || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: DecisionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.decision || !VEHICLE_DECISIONS.includes(body.decision as VehicleDecision)) {
    return NextResponse.json(
      { error: "decision must be one of: approved, denied, completed" },
      { status: 400 }
    );
  }

  const result = await decideVehicleBooking(
    supabase,
    user.id,
    id,
    body.decision as VehicleDecision,
    body.note
  );
  if (!result.ok) {
    const { error, status, blockedDriver, reason } = result;
    return NextResponse.json({ error, blockedDriver, reason }, { status });
  }

  // Slack: rewrite the coordinator's request DM to say it's decided.
  after(() => refreshVehicleRequestAlerts(id));

  return NextResponse.json({ ok: true });
}
