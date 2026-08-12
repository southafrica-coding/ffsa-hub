import { AlertTriangle } from "lucide-react";
import { groupMissingFields, type LifecycleInfo } from "@/lib/users/lifecycle";

// User-facing "what's still missing" banner shown at the top of the profile
// page when the profile-completion gate would still block this user. Reuses the
// exact same lifecycle derivation as the admin Users badge, so the two surfaces
// can never disagree about what's outstanding. Nothing renders once complete.
export function ProfileIncompleteSummary({
  lifecycle,
}: {
  lifecycle: LifecycleInfo;
}) {
  if (lifecycle.stage !== "profile_incomplete") return null;

  const groups = groupMissingFields(lifecycle.missingFields);
  const count = lifecycle.missingFields.length;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            Your profile is incomplete
          </p>
          <p className="mt-0.5 text-sm text-amber-800/90 dark:text-amber-200/80">
            {lifecycle.completedRequired} of {lifecycle.totalRequired} required
            details completed — {count} still missing. Use the{" "}
            <span className="font-medium">Edit</span> button on the matching
            section below to fill these in.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.section}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300/80">
                  {group.section}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {group.fields.map((field) => (
                    <li
                      key={field.field}
                      className="text-sm text-amber-900 dark:text-amber-100"
                    >
                      {field.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
