import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getDriverForTest,
  setDriverTestStatus,
} from "@/services/vehicles";

/**
 * Record a base-vehicle driving-test result.
 *
 * The result belongs to the PERSON, not the booking: passing once clears
 * every future request. Without this endpoint a driver marked "pending"
 * could never be cleared, and the approval gate would be a dead end.
 *
 * Vehicle managers only — this is the control that unblocks a hard block, so
 * it must not be reachable by the person it applies to.
 */

const RESULTS = ["not_required", "pending", "passed", "failed"] as const;
type Result = (typeof RESULTS)[number];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ driverId: string }> }
) {
  const { driverId } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canApprove || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const result = String(body.result ?? "") as Result;
  if (!RESULTS.includes(result)) {
    return NextResponse.json(
      { error: "result must be one of: not_required, pending, passed, failed" },
      { status: 400 }
    );
  }
  const note = String(body.note ?? "").trim() || null;

  const admin = createAdminClient();
  const driver = await getDriverForTest(admin, driverId);
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  // The driver row always reflects the result, so the booking's own history
  // stays readable even for an outsider with no profile to write to.
  const { error: rowErr } = await setDriverTestStatus(admin, driverId, result);
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });

  if (driver.user_id) {
    const { error } = await admin
      .from("users")
      .update({
        base_driving_test_status: result,
        base_driving_test_passed_at: result === "passed" ? new Date().toISOString() : null,
        base_driving_test_note: note,
      })
      .eq("id", driver.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result, appliedToProfile: !!driver.user_id });
}
