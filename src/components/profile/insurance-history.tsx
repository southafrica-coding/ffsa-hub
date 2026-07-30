import { getInsuranceStatus } from "@/lib/users/profile-fields";
import { deletablePolicyIds } from "@/lib/users/insurance-policies";
import { DeletePolicyButton } from "@/components/profile/delete-policy-button";

// A list of a person's health-insurance policies — the current one plus every
// previous policy kept on record (migration 130). Rendered under the Health
// Insurance card on the profile page and on the admin user detail page. When
// `canDelete` is set (own profile), duplicate rows show a delete control; the
// caller fetches via getInsurancePolicies() and passes the current policy id.

export type InsurancePolicyRow = {
  id: string;
  provider: string;
  policy_number: string | null;
  expiry_date: string; // YYYY-MM-DD
  recorded_at: string; // ISO timestamp
};

// Format a YYYY-MM-DD / ISO value as e.g. "3 Sep 2026" (UTC, so a date-only
// value doesn't drift across the day boundary).
function fmt(value: string): string {
  const iso = value.length <= 10 ? `${value}T00:00:00Z` : value;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return value;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function InsuranceHistory({
  policies,
  currentPolicyId,
  canDelete = false,
}: {
  policies: InsurancePolicyRow[];
  currentPolicyId?: string | null;
  canDelete?: boolean;
}) {
  if (!policies || policies.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No insurance policies on record yet.
      </p>
    );
  }

  const deletable = canDelete
    ? deletablePolicyIds(policies, currentPolicyId ?? null)
    : new Set<string>();

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Policies on record
      </div>
      <ul className="space-y-2">
        {policies.map((p, i) => {
          const isCurrent = i === 0; // most recently recorded = the active policy
          const status = getInsuranceStatus({ health_insurance_expiry_date: p.expiry_date });
          const expired = status.state === "expired";
          return (
            <li
              key={p.id}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium break-words">{p.provider}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {isCurrent && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Current
                    </span>
                  )}
                  {deletable.has(p.id) && <DeletePolicyButton policyId={p.id} />}
                </div>
              </div>
              {p.policy_number && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  Policy no. {p.policy_number}
                </div>
              )}
              <div
                className={
                  "text-xs mt-0.5 " +
                  (expired ? "text-destructive" : "text-muted-foreground")
                }
              >
                {expired ? "Expired" : "Expires"} {fmt(p.expiry_date)}
                <span className="opacity-50"> · </span>
                added {fmt(p.recorded_at)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
