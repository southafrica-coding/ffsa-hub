// ────────────────────────────────────────────────────────────
// Dashboard widget registry
// ────────────────────────────────────────────────────────────
// The single source of truth for what CAN appear on the dashboard and what
// is on by DEFAULT — both now role-aware. Adding a widget is one entry here
// plus a component wired into the render map in `dashboard/page.tsx`.
//
// Permission is TWO-LAYER, and the split matters:
//
//   1. `gate(ctx)` decides what the Customise panel OFFERS a user, and
//      `defaultEnabled(ctx)` decides what starts ON for a user with no saved
//      layout. Both are cheap sync predicates over a precomputed
//      DashboardContext (see context.ts).
//   2. The widget's own API route re-checks permission server-side.
//
// A stored layout is a preference, never an authorisation. Someone who
// hand-crafts a PUT enabling `schools-counts` without schools access gets an
// empty widget, not data. Never let layer 1 be the only check.
// ────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDashboardContext, type DashboardContext } from "./context";
import { getStoredLayout } from "@/services/dashboard";

export type WidgetCategory =
  | "Overview"
  | "Schools"
  | "Bookings"
  | "Prayer Room";

export type WidgetDef = {
  // Stable identifier persisted in dashboard_layouts.layout. Renaming a key
  // orphans it in every saved layout — treat these as permanent.
  key: string;
  title: string;
  // Shown under the title in the Customise panel, so write it for the
  // person choosing, not for the developer.
  description: string;
  category: WidgetCategory;
  // Position when a user has no saved preference for this widget.
  defaultOrder: number;
  // Whether the widget spans both columns of the dashboard grid.
  fullWidth: boolean;
  // Availability: can this widget appear in the Customise panel / resolve at
  // all for this user? Omit for widgets everyone may use.
  gate?: (ctx: DashboardContext) => boolean;
  // On-by-default for a user with no saved layout. Role-aware.
  defaultEnabled: (ctx: DashboardContext) => boolean;
};

// ────────────────────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────────────────────
// defaultOrder values are spaced so widgets can be slotted between existing
// ones later. Admins ("dev team") keep the pre-role-based default set, so
// their defaultEnabled mirrors the old global defaults; everyone else gets a
// strictly curated set — only the widgets their roles call for.
//
// "Curated" previously meant EMPTY for an account with no role: every
// defaultEnabled tested isAdmin / hasSchoolsAccess / isMinistryLeader /
// isVehiclesPerson / isPrayerRoomStaff / hasStaffRole, so a new person's
// first screen after the profile gate was "Your dashboard is empty. Use
// Customise above to choose what appears here." Three widgets now default
// on for everyone who can actually use them: the base calendar and the
// prayer room week are open to every account, and space bookings follows
// the module's own access rule (migration 162 — ministry leaders and the
// booking admin roles, NOT the baseline floor). Each has a real empty state.

export const WIDGET_REGISTRY: WidgetDef[] = [
  {
    key: "notification-feed",
    title: "Needs attention",
    description:
      "Actionable items from across the Hub — booking requests, staff awaiting approval, records to match.",
    category: "Overview",
    defaultOrder: 10,
    fullWidth: true,
    defaultEnabled: (c) => c.isAdmin,
  },
  {
    key: "legal-documents",
    title: "Legal papers",
    description:
      "FFSA's legal papers and the legal officer's own: what has expired, what needs renewing, and applications that are due. Only for people on the Documents access list.",
    category: "Overview",
    defaultOrder: 14,
    fullWidth: false,
    gate: (c) => c.hasLegalAccess,
    defaultEnabled: (c) => c.hasLegalAccess,
  },
  {
    key: "staff-insurance",
    title: "Staff insurance alerts",
    description:
      "Staff whose health insurance is missing, expired, or expiring soon. Dev team only — insurance is medical data, so it is not shown to ministry leaders.",
    category: "Overview",
    defaultOrder: 15,
    fullWidth: true,
    gate: (c) => c.isAdmin,
    defaultEnabled: (c) => c.isAdmin,
  },

  {
    key: "upcoming-events",
    title: "Upcoming events ticker",
    description: "Scrolling view of what's next on the FFSA base calendar.",
    category: "Overview",
    defaultOrder: 20,
    fullWidth: false,
    // On for everyone: the base calendar is the one thing every account
    // has a reason to see, and the widget self-hides when there is nothing
    // scheduled rather than showing an empty box.
    defaultEnabled: () => true,
  },
  {
    key: "my-bookings",
    title: "My space bookings",
    description: "Rooms and spaces you have booked, and their approval status.",
    category: "Bookings",
    defaultOrder: 30,
    fullWidth: false,
    // Space Bookings is NOT part of the baseline floor — migration 162 took
    // bookings.view off self_service, leaving the module to ministry leaders,
    // booking managers, leadership_team and admins. Gated on the same
    // predicate as the page guard so this never offers a door that will not
    // open; on by default for exactly the people who can walk through it.
    gate: (c) => c.hasBookingsAccess,
    defaultEnabled: (c) => c.hasBookingsAccess,
  },
  {
    key: "vehicles",
    title: "Vehicle requests",
    description:
      "Vehicle bookings awaiting approval. For vehicle managers and approvers.",
    category: "Bookings",
    defaultOrder: 35,
    fullWidth: false,
    gate: (c) => c.isAdmin || c.isVehiclesPerson,
    defaultEnabled: (c) => c.isAdmin || c.isVehiclesPerson,
  },
  {
    key: "prayer-week",
    title: "Prayer room — this week",
    description: "This week's prayer room schedule and your own slots.",
    category: "Prayer Room",
    defaultOrder: 40,
    fullWidth: true,
    // On for everyone: the prayer room is in the baseline access floor, so
    // gating its widget to prayer-room STAFF hid it from exactly the people
    // the floor was meant to include.
    defaultEnabled: () => true,
  },
  {
    key: "stat-cards",
    title: "Headline numbers",
    description:
      "Active contacts, published events, active users and recent registrations.",
    category: "Overview",
    defaultOrder: 50,
    fullWidth: true,
    defaultEnabled: (c) => c.isAdmin,
  },
  {
    key: "schools-counts",
    title: "Applications & enrolment by school",
    description:
      "How many students have applied to each school, how many were accepted, and how many are enrolled.",
    category: "Schools",
    defaultOrder: 60,
    fullWidth: true,
    gate: (c) => c.hasSchoolsAccess,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "schools-track",
    title: "Who's doing which part",
    description:
      "For schools split into sections (like FFX): how many accepted students are doing the whole programme versus which sections, so you can plan each part.",
    category: "Schools",
    defaultOrder: 65,
    fullWidth: true,
    gate: (c) => c.hasSchoolsAccess,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "schools-pipeline",
    title: "Application pipeline & conversion",
    description:
      "Where students fall out between applying and arriving — acceptance rate and accepted-to-arrival conversion per school.",
    category: "Schools",
    defaultOrder: 70,
    fullWidth: true,
    gate: (c) => c.hasSchoolsAccess,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "students-by-tier",
    title: "ABC Country",
    description:
      "Accepted and enrolled students split by country fee tier (A full price, B reduced, C heavily reduced) per school.",
    category: "Schools",
    defaultOrder: 72,
    fullWidth: true,
    gate: (c) => c.hasSchoolsAccess,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "students-by-nationality",
    title: "Student Citizenship",
    description:
      "Accepted and enrolled students by country of citizenship, ranked, across all schools or one you pick.",
    category: "Schools",
    defaultOrder: 74,
    fullWidth: true,
    gate: (c) => c.hasSchoolsAccess,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "students-by-gender",
    title: "Gender split by school",
    description:
      "The male / female balance of each school's accepted and enrolled students.",
    category: "Schools",
    defaultOrder: 76,
    fullWidth: true,
    gate: (c) => c.hasSchoolsAccess,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "my-assignments",
    title: "My assigned students",
    description:
      "Applicants and students assigned to you for follow-up. Only shows if you have assignments.",
    category: "Schools",
    defaultOrder: 80,
    fullWidth: true,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "staff-workload",
    title: "Staff workload",
    description:
      "How assigned applicants and students are spread across your team.",
    category: "Schools",
    defaultOrder: 90,
    fullWidth: true,
    defaultEnabled: (c) => c.isAdmin || c.hasSchoolsAccess,
  },
  {
    key: "events-table",
    title: "Upcoming events list",
    description: "The next published events, with dates and locations.",
    category: "Overview",
    defaultOrder: 100,
    fullWidth: false,
    defaultEnabled: (c) => c.isAdmin,
  },
  {
    key: "recent-registrations",
    title: "Recent registrations",
    description: "The latest event registrations as they come in.",
    category: "Overview",
    defaultOrder: 110,
    fullWidth: false,
    defaultEnabled: (c) => c.isAdmin,
  },
];

export const WIDGET_KEYS = new Set(WIDGET_REGISTRY.map((w) => w.key));

export function getWidget(key: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.key === key);
}

// ────────────────────────────────────────────────────────────
// LAYOUT RESOLUTION
// ────────────────────────────────────────────────────────────

export type LayoutEntry = { key: string; enabled: boolean };

export type ResolvedLayout = {
  entries: LayoutEntry[];
  enabledKeys: string[];
  isDefault: boolean;
};

// Which widgets may this user use at all? Sync filter over the precomputed
// context — gates must stay pure predicates.
export function getPermittedWidgets(ctx: DashboardContext): WidgetDef[] {
  return WIDGET_REGISTRY.filter((w) => (w.gate ? w.gate(ctx) : true));
}

// Merge a stored layout over registry defaults.
//
//   - Unknown keys are DROPPED, so deleting a widget can't break saved layouts.
//   - Widgets missing from the stored layout are INSERTED at defaultOrder, so
//     a newly shipped widget appears for existing users.
export function mergeLayout(
  stored: LayoutEntry[] | null,
  permitted: WidgetDef[],
  ctx: DashboardContext
): ResolvedLayout {
  const permittedByKey = new Map(permitted.map((w) => [w.key, w]));

  if (!stored || stored.length === 0) {
    const entries = [...permitted]
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .map((w) => ({ key: w.key, enabled: w.defaultEnabled(ctx) }));
    return {
      entries,
      enabledKeys: entries.filter((e) => e.enabled).map((e) => e.key),
      isDefault: true,
    };
  }

  const seen = new Set<string>();
  const merged: LayoutEntry[] = [];

  // Stored order wins for anything the user has actually expressed a view on.
  for (const entry of stored) {
    if (!permittedByKey.has(entry.key) || seen.has(entry.key)) continue;
    seen.add(entry.key);
    merged.push({ key: entry.key, enabled: entry.enabled !== false });
  }

  // Anything new since they last saved slots in at its default position and
  // default-enabled state.
  const newcomers = permitted
    .filter((w) => !seen.has(w.key))
    .sort((a, b) => a.defaultOrder - b.defaultOrder);

  for (const widget of newcomers) {
    const insertAt = merged.findIndex((e) => {
      const existing = permittedByKey.get(e.key);
      return existing !== undefined && existing.defaultOrder > widget.defaultOrder;
    });
    const item = { key: widget.key, enabled: widget.defaultEnabled(ctx) };
    if (insertAt === -1) merged.push(item);
    else merged.splice(insertAt, 0, item);
  }

  return {
    entries: merged,
    enabledKeys: merged.filter((e) => e.enabled).map((e) => e.key),
    isDefault: false,
  };
}

// Read a user's stored layout and resolve it against the registry + their
// role-derived context. Call this from the dashboard page (server) and the
// layout API.
export async function resolveLayout(
  supabase: SupabaseClient,
  userId: string
): Promise<ResolvedLayout> {
  // The stored layout doesn't depend on the context — read both at once.
  const [ctx, stored] = await Promise.all([
    buildDashboardContext(supabase, userId),
    getStoredLayout(supabase, userId),
  ]);
  const permitted = getPermittedWidgets(ctx);

  const raw = (stored.data?.layout ?? null) as unknown;
  const parsed = Array.isArray(raw)
    ? (raw.filter(
        (e) =>
          e && typeof e === "object" && typeof (e as LayoutEntry).key === "string"
      ) as LayoutEntry[])
    : null;

  return mergeLayout(parsed, permitted, ctx);
}

// Convenience for the layout PUT route, which only needs the permitted set to
// filter an incoming layout.
export async function resolvePermittedWidgets(
  supabase: SupabaseClient,
  userId: string
): Promise<WidgetDef[]> {
  const ctx = await buildDashboardContext(supabase, userId);
  return getPermittedWidgets(ctx);
}
