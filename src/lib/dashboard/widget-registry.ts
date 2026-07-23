// ────────────────────────────────────────────────────────────
// Dashboard widget registry
// ────────────────────────────────────────────────────────────
// The single source of truth for what CAN appear on the dashboard.
// Adding a widget anywhere in the Hub is one entry in WIDGET_REGISTRY
// plus a component wired into the render map in `dashboard-grid.tsx`.
//
// Permission is TWO-LAYER, and the split matters:
//
//   1. `gate` here decides what the Customise panel OFFERS a user.
//   2. The widget's own API route re-checks permission server-side.
//
// A stored layout is a preference, never an authorisation. Someone who
// hand-crafts a PUT enabling `schools-counts` without schools access
// gets an empty widget, not data. Never let layer 1 be the only check.
// ────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSchoolsCountScopes } from "@/lib/auth/schools-count-scopes";
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
  defaultEnabled: boolean;
  // Position when a user has no saved preference for this widget. These
  // reproduce the pre-customisation dashboard exactly.
  defaultOrder: number;
  // Whether the widget spans both columns of the dashboard grid. This is a
  // property of the widget (a wide table needs the room; a compact list does
  // not), NOT a user preference — users choose what and in what order, the
  // widget decides how much room it needs.
  fullWidth: boolean;
  // Optional access check. Omit for widgets everyone may use (baseline
  // access). Returning false hides the widget from the Customise panel
  // AND strips it from the resolved layout.
  gate?: (supabase: SupabaseClient, userId: string) => Promise<boolean>;
};

// ────────────────────────────────────────────────────────────
// GATES
// ────────────────────────────────────────────────────────────

// Any visibility into schools application/enrolment counts — a program-scoped
// grant or an admin/leader role. Mirrors the check the analytics route makes.
async function hasSchoolsCountAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { globalLevel, programLevels } = await getSchoolsCountScopes(
    supabase,
    userId
  );
  return globalLevel !== null || Object.keys(programLevels).length > 0;
}

// ────────────────────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────────────────────
// defaultOrder values are spaced by 10 so widgets can be slotted between
// existing ones later without renumbering the whole registry.

export const WIDGET_REGISTRY: WidgetDef[] = [
  {
    key: "notification-feed",
    title: "Needs attention",
    description:
      "Actionable items from across the Hub — booking requests, staff awaiting approval, records to match.",
    category: "Overview",
    defaultEnabled: true,
    defaultOrder: 10,
    fullWidth: true,
  },
  {
    key: "upcoming-events",
    title: "Upcoming events ticker",
    description: "Scrolling view of what's next on the FFSA base calendar.",
    category: "Overview",
    defaultEnabled: true,
    defaultOrder: 20,
    fullWidth: false,
  },
  {
    key: "my-bookings",
    title: "My space bookings",
    description: "Rooms and spaces you have booked, and their approval status.",
    category: "Bookings",
    defaultEnabled: true,
    defaultOrder: 30,
    fullWidth: false,
  },
  {
    key: "prayer-week",
    title: "Prayer room — this week",
    description: "This week's prayer room schedule and your own slots.",
    category: "Prayer Room",
    defaultEnabled: true,
    defaultOrder: 40,
    fullWidth: true,
  },
  {
    key: "stat-cards",
    title: "Headline numbers",
    description:
      "Active contacts, published events, active users and recent registrations.",
    category: "Overview",
    defaultEnabled: true,
    defaultOrder: 50,
    fullWidth: true,
  },
  {
    key: "schools-counts",
    title: "Applications & enrolment by school",
    description:
      "How many students have applied to each school, how many were accepted, and how many are enrolled.",
    category: "Schools",
    defaultEnabled: true,
    defaultOrder: 60,
    fullWidth: true,
    gate: hasSchoolsCountAccess,
  },
  {
    key: "schools-pipeline",
    title: "Application pipeline & conversion",
    description:
      "Where students fall out between applying and arriving — acceptance rate and accepted-to-arrival conversion per school.",
    category: "Schools",
    defaultEnabled: true,
    defaultOrder: 70,
    fullWidth: true,
    gate: hasSchoolsCountAccess,
  },
  {
    key: "students-by-tier",
    title: "Fee tier by school",
    description:
      "How many students fall into each fee tier (A full price, B reduced, C heavily reduced) per school.",
    category: "Schools",
    defaultEnabled: false,
    defaultOrder: 72,
    fullWidth: true,
    gate: hasSchoolsCountAccess,
  },
  {
    key: "students-by-nationality",
    title: "Where students come from",
    description:
      "Share of students by country, ranked, across all schools or one you pick.",
    category: "Schools",
    defaultEnabled: false,
    defaultOrder: 74,
    fullWidth: true,
    gate: hasSchoolsCountAccess,
  },
  {
    key: "students-by-gender",
    title: "Gender split by school",
    description: "The male / female balance of each school's students.",
    category: "Schools",
    defaultEnabled: false,
    defaultOrder: 76,
    fullWidth: true,
    gate: hasSchoolsCountAccess,
  },
  {
    key: "my-assignments",
    title: "My assigned students",
    description:
      "Applicants and students assigned to you for follow-up. Only shows if you have assignments.",
    category: "Schools",
    defaultEnabled: true,
    defaultOrder: 80,
    fullWidth: true,
  },
  {
    key: "staff-workload",
    title: "Staff workload",
    description:
      "How assigned applicants and students are spread across your team.",
    category: "Schools",
    defaultEnabled: true,
    defaultOrder: 90,
    fullWidth: true,
  },
  {
    key: "events-table",
    title: "Upcoming events list",
    description: "The next published events, with dates and locations.",
    category: "Overview",
    defaultEnabled: true,
    defaultOrder: 100,
    fullWidth: false,
  },
  {
    key: "recent-registrations",
    title: "Recent registrations",
    description: "The latest event registrations as they come in.",
    category: "Overview",
    defaultEnabled: true,
    defaultOrder: 110,
    fullWidth: false,
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
  // Every widget the user is allowed to use, in their chosen order, each
  // flagged enabled/disabled. The Customise panel renders this whole list.
  entries: LayoutEntry[];
  // Convenience: just the enabled keys, in order. This is what the grid renders.
  enabledKeys: string[];
  // True when the user has never customised — lets the UI say so.
  isDefault: boolean;
};

// Which widgets may this user use at all? Gates run in parallel; a gate that
// throws is treated as "no access" so one broken gate can't blank the dashboard.
export async function getPermittedWidgets(
  supabase: SupabaseClient,
  userId: string
): Promise<WidgetDef[]> {
  const results = await Promise.all(
    WIDGET_REGISTRY.map(async (widget) => {
      if (!widget.gate) return widget;
      try {
        return (await widget.gate(supabase, userId)) ? widget : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((w): w is WidgetDef => w !== null);
}

// Merge a stored layout over registry defaults.
//
// Two properties this has to hold, both about surviving registry changes:
//   - Unknown keys are DROPPED, so deleting a widget from the registry can
//     never break someone's saved layout.
//   - Widgets missing from the stored layout are INSERTED at defaultOrder,
//     so a newly shipped widget appears for existing users instead of
//     staying invisible to everyone who ever hit Save.
export function mergeLayout(
  stored: LayoutEntry[] | null,
  permitted: WidgetDef[]
): ResolvedLayout {
  const permittedByKey = new Map(permitted.map((w) => [w.key, w]));

  if (!stored || stored.length === 0) {
    const entries = [...permitted]
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .map((w) => ({ key: w.key, enabled: w.defaultEnabled }));
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

  // Anything new since they last saved slots in at its default position.
  const newcomers = permitted
    .filter((w) => !seen.has(w.key))
    .sort((a, b) => a.defaultOrder - b.defaultOrder);

  for (const widget of newcomers) {
    // Find the first existing entry that should sort after this newcomer,
    // and insert ahead of it — keeping the user's ordering intact around it.
    const insertAt = merged.findIndex((e) => {
      const existing = permittedByKey.get(e.key);
      return existing !== undefined && existing.defaultOrder > widget.defaultOrder;
    });
    const item = { key: widget.key, enabled: widget.defaultEnabled };
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
// permissions. Call this from the dashboard page (server) and the layout API.
export async function resolveLayout(
  supabase: SupabaseClient,
  userId: string
): Promise<ResolvedLayout> {
  const [permitted, stored] = await Promise.all([
    getPermittedWidgets(supabase, userId),
    getStoredLayout(supabase, userId),
  ]);

  const raw = (stored.data?.layout ?? null) as unknown;
  const parsed = Array.isArray(raw)
    ? (raw.filter(
        (e) =>
          e && typeof e === "object" && typeof (e as LayoutEntry).key === "string"
      ) as LayoutEntry[])
    : null;

  return mergeLayout(parsed, permitted);
}
