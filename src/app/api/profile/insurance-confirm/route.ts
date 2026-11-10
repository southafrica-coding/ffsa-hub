import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { todayInSA } from "@/lib/users/profile-fields";
import { rejectIfDeactivated } from "@/lib/users/self-edit-guard";
import { usersUpdateDeniedResponse } from "@/lib/users/users-update-error";

// POST /api/profile/insurance-confirm — the caller confirms their
// open-ended medical scheme membership is still active.
//
// An open-ended policy never lapses on its own, so nothing else would ever
// prompt someone who quietly switched schemes. Once a year they say "yes,
// still active" and the clock restarts.
//
// This touches ONLY health_insurance_confirmed_at, which the insurance
// history trigger deliberately does not watch — so confirming can never
// spawn a duplicate row in "Policies on record".
export async function POST() {
  const supabase = await createClient();
  // health_insurance_no_expiry / _confirmed_at (migration 211) aren't in the
  // generated DB types yet — same loose-handle pattern used elsewhere for
  // not-yet-generated columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const blocked = await rejectIfDeactivated(db, user.id);
  if (blocked) return blocked;

  const { data: row, error: readError } = await db
    .from("users")
    .select("health_insurance_provider, health_insurance_no_expiry")
    .eq("id", user.id)
    .single();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const provider = String(row?.health_insurance_provider ?? "")
    .trim()
    .toLowerCase();
  if (row?.health_insurance_no_expiry !== true || provider === "" || provider === "none") {
    return NextResponse.json(
      {
        error:
          "There's no open-ended policy on your profile to confirm. Please update your health insurance details instead.",
      },
      { status: 400 }
    );
  }

  const { error } = await db
    .from("users")
    .update({ health_insurance_confirmed_at: todayInSA() })
    .eq("id", user.id);
  if (error) {
    const denied = usersUpdateDeniedResponse(error);
    if (denied) return denied;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
