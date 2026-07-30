import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInsurancePolicies, deleteInsurancePolicy } from "@/services/users";
import { getAuthedUser } from "@/lib/api-auth";
import {
  currentPolicyId,
  deletablePolicyIds,
  type PolicyRow,
} from "@/lib/users/insurance-policies";

// DELETE /api/profile/insurance-policies/[id] — a user removes a DUPLICATE
// row from their own insurance history. Only a duplicate (another row shares
// its policy number) that is neither the current policy nor the last row may
// go, so the current insurance always stays on record. RLS on
// user_insurance_policies is SELECT-only, so the delete runs via the admin
// client with the rule enforced here in code.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: policyId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Only ever load the caller's own rows — a policy id that isn't in this list
  // is either someone else's or doesn't exist, so it 404s (ownership enforced).
  const { data: policies, error: readErr } = await getInsurancePolicies(
    supabase,
    user.id
  );
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const rows = (policies ?? []) as PolicyRow[];
  const target = rows.find((p) => p.id === policyId);
  if (!target) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  if (rows.length <= 1) {
    return NextResponse.json(
      { error: "You can't delete your only insurance record." },
      { status: 400 }
    );
  }

  const { data: me } = await supabase
    .from("users")
    .select(
      "health_insurance_provider, health_insurance_policy_number, health_insurance_expiry_date"
    )
    .eq("id", user.id)
    .single();

  const curId = currentPolicyId(rows, {
    provider: me?.health_insurance_provider,
    policy_number: me?.health_insurance_policy_number,
    expiry_date: me?.health_insurance_expiry_date,
  });
  if (target.id === curId) {
    return NextResponse.json(
      { error: "You can't delete your current insurance policy." },
      { status: 400 }
    );
  }

  if (!deletablePolicyIds(rows, curId).has(target.id)) {
    return NextResponse.json(
      { error: "Only duplicate insurance records can be deleted." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await deleteInsurancePolicy(admin, target.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
