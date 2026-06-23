import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess, updateVehicleBooking } from "@/services/vehicles";

type DecisionBody = { decision?: string; note?: string };

const ALLOWED = ["approved", "denied", "completed"];

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

  if (!body.decision || !ALLOWED.includes(body.decision)) {
    return NextResponse.json(
      { error: "decision must be one of: approved, denied, completed" },
      { status: 400 }
    );
  }

  const note = (body.note ?? "").trim();
  const { error } = await updateVehicleBooking(supabase, id, {
    status: body.decision,
    decision_note: note.length ? note : null,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
