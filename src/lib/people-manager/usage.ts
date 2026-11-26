// Leave used per type against the yearly guideline, per calendar year
// (421: the leave year starts 1 January). Same sums as 421's leave_balances
// view, done in TS so one read of requests serves the form, the dashboard,
// the person view and the Slack card:
//   used    = approved days in the year (future approved leave included)
//   pending = pending days in the year
//   over    = max(used − guideline, 0); null for an uncapped type
// A request across a year boundary counts each year's own days
// (days_by_year). Declined and cancelled requests never count.
// Guidelines are guidance only: nothing here blocks a request.

import { daysInYear } from "./days";
import type { LeaveEffectiveType, LeaveRequest } from "./db.types";

export type UsageRequest = Pick<LeaveRequest, "leave_type_id" | "status" | "days_by_year"> & {
  requester_id?: string;
};

export type TypeUsage = {
  leave_type_id: string;
  slug: string;
  label: string;
  /** Yearly guideline; null = no guideline (still counted). */
  guideline: number | null;
  used: number;
  pending: number;
  /** null when uncapped; negative when over. */
  remaining: number | null;
  /** null when uncapped; 0 when within. */
  over: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Usage for one person and year, one row per effective type of the
 * department (inactive types only when they have days). `typeSlugById`
 * maps any leave_type_id a request may carry (a base default or another
 * department's row) to its slug, so an override's guideline applies to the
 * default's requests, like the view.
 */
export function usageByType(input: {
  types: readonly Pick<LeaveEffectiveType, "id" | "slug" | "label" | "sort_order" | "is_active" | "annual_allowance_days">[];
  requests: readonly UsageRequest[];
  year: number;
  typeSlugById?: ReadonlyMap<string, string>;
}): TypeUsage[] {
  const bySlug = new Map<string, { used: number; pending: number }>();
  const slugOf = (id: string) => input.typeSlugById?.get(id) ?? input.types.find((t) => t.id === id)?.slug ?? null;
  for (const r of input.requests) {
    if (r.status !== "approved" && r.status !== "pending") continue;
    const slug = slugOf(r.leave_type_id);
    if (!slug) continue;
    const days = daysInYear(r.days_by_year, input.year);
    if (!days) continue;
    const acc = bySlug.get(slug) ?? { used: 0, pending: 0 };
    if (r.status === "approved") acc.used += days;
    else acc.pending += days;
    bySlug.set(slug, acc);
  }
  return [...input.types]
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .filter((t) => t.is_active || bySlug.has(t.slug))
    .map((t) => {
      const acc = bySlug.get(t.slug) ?? { used: 0, pending: 0 };
      const guideline = t.annual_allowance_days === null ? null : Number(t.annual_allowance_days);
      const used = round1(acc.used);
      return {
        leave_type_id: t.id,
        slug: t.slug,
        label: t.label,
        guideline,
        used,
        pending: round1(acc.pending),
        remaining: guideline === null ? null : round1(guideline - used),
        over: guideline === null ? null : round1(Math.max(used - guideline, 0)),
      };
    });
}

/** What a new (or pending) request does to one type's year: "8 used + 7 → 15 of 15". */
export function projectRequest(usage: TypeUsage, requestDays: number) {
  const total = round1(usage.used + requestDays);
  return {
    used: usage.used,
    this_request: round1(requestDays),
    total,
    guideline: usage.guideline,
    over: usage.guideline === null ? null : round1(Math.max(total - usage.guideline, 0)),
    reaches_guideline: usage.guideline !== null && total >= usage.guideline,
  };
}

/**
 * The Slack / dashboard line, where `total` already includes the request
 * being asked for: "Sick: 7 of 5 guideline days used (+2 over)",
 * "Annual leave: 15 of 15 guideline days used", "Unpaid leave: 3 days used (no guideline)".
 */
export function guidelineLine(label: string, total: number, guideline: number | null): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (guideline === null) return `${label}: ${n(total)} day${total === 1 ? "" : "s"} used (no guideline)`;
  const over = round1(total - guideline);
  return `${label}: ${n(total)} of ${n(guideline)} guideline days used${over > 0 ? ` (+${n(over)} over)` : ""}`;
}
