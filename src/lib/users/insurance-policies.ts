// Shared rules for the health-insurance policy history so the profile UI
// and the delete API agree on exactly one definition of "current" and
// "deletable". A user may delete a history row ONLY when it is a genuine
// duplicate — another row shares its policy number — and it is neither the
// current active policy nor the last remaining row. This guarantees the
// current insurance always stays on record and only redundant copies go.

export type PolicyRow = {
  id: string;
  provider: string;
  policy_number: string | null;
  expiry_date: string | null; // YYYY-MM-DD, null for an open-ended policy
  no_expiry?: boolean;
  recorded_at: string; // ISO timestamp
};

export type CurrentInsurance = {
  provider?: string | null;
  policy_number?: string | null;
  expiry_date?: string | null;
  no_expiry?: boolean | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim();
const day = (v: string | null | undefined) => norm(v).slice(0, 10);

/**
 * The id of the row representing the user's current, active policy — the one
 * matching the live users.health_insurance_* values. If several match, the
 * most recently recorded wins; if none match (data drift), fall back to the
 * most recently recorded row overall. Expects `policies` ordered recorded_at
 * DESC (as getInsurancePolicies returns them). Returns null when empty.
 */
export function currentPolicyId(
  policies: PolicyRow[],
  current: CurrentInsurance
): string | null {
  if (policies.length === 0) return null;
  const match = policies.find(
    (p) =>
      norm(p.provider) === norm(current.provider) &&
      norm(p.policy_number) === norm(current.policy_number) &&
      day(p.expiry_date) === day(current.expiry_date) &&
      // An open-ended row and a dated one are different policies even when
      // everything else lines up — otherwise the wrong row is protected
      // from deletion after a switch.
      (p.no_expiry ?? false) === (current.no_expiry ?? false)
  );
  return (match ?? policies[0]).id;
}

/**
 * The set of policy-row ids the user is allowed to delete: a row is deletable
 * when it is NOT the current policy and another row shares its policy number
 * (null-aware — two blank policy numbers are duplicates of each other).
 */
export function deletablePolicyIds(
  policies: PolicyRow[],
  curId: string | null
): Set<string> {
  const countByKey = new Map<string, number>();
  for (const p of policies) {
    const key = norm(p.policy_number);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }
  const deletable = new Set<string>();
  for (const p of policies) {
    if (p.id === curId) continue;
    if ((countByKey.get(norm(p.policy_number)) ?? 0) > 1) deletable.add(p.id);
  }
  return deletable;
}
