// The tabs (five for everyone, six for Training staff) and who sees them. Route-folder contract (README):
//   Home    app/(app)/index.tsx
//   Finance app/(app)/finance/   (slice 2)
//   Prayer  app/(app)/prayer/    (Phase 2 slice 2)
//   Tickets app/(app)/tickets/   (slice 3; check-in at tickets/check-in/…)
//   Me      app/(app)/me/
//
// Tabs are matched on the route's FIRST path segment, so "finance" (a folder
// with its own _layout.tsx) and "finance/index" (a bare index.tsx) are the
// same tab. That lets the placeholders and the real slices swap in without
// touching this file.

import { CircleUser, Flame, GraduationCap, House, Ticket, Wallet, type LucideIcon } from "lucide-react-native";

import { hasTrainingAccess } from "@/features/training/logic";
import type { Me } from "@/lib/api";

import { shellStrings } from "./strings";

export type TabId = "home" | "training" | "finance" | "prayer" | "tickets" | "me";

export type TabDef = {
  id: TabId;
  /** First route segment under app/(app)/ ("index" for Home). */
  segment: string;
  label: string;
  icon: LucideIcon;
  /**
   * UX gate from GET /api/me. Omit for "everyone signed in". While /api/me is
   * loading (or failed) `me` is null: decide what a gated tab does then.
   */
  visible?: (me: Me | null) => boolean;
};

// Every tab but Training is for everyone: My Finance, My Events/tickets and Me are
// open to every signed-in user on the web (feature-inventory.md). Staff-only
// things (door check-in) live INSIDE a tab and gate themselves with useCan().
export const TABS: readonly TabDef[] = [
  { id: "home", segment: "index", label: shellStrings.tabs.home, icon: House },
  // Training staff only (redesign 48i): Training module, program staff, or
  // walking with a student. Everyone else keeps the five tabs below.
  { id: "training", segment: "training", label: shellStrings.tabs.training, icon: GraduationCap, visible: hasTrainingAccess },
  { id: "finance", segment: "finance", label: shellStrings.tabs.finance, icon: Wallet },
  { id: "prayer", segment: "prayer", label: shellStrings.tabs.prayer, icon: Flame },
  { id: "tickets", segment: "tickets", label: shellStrings.tabs.tickets, icon: Ticket },
  { id: "me", segment: "me", label: shellStrings.tabs.me, icon: CircleUser },
];

/** "finance/index" -> "finance"; "index" -> "index". */
export function routeSegment(routeName: string): string {
  return routeName.split("/")[0] ?? routeName;
}

// Hidden routes (no tab of their own, opened from Home) mark Home active.
export const HOME_ROUTES: readonly string[] = ["bookings", "schools", "history", "okrs", "ministries", "staff-decisions"];

/** The tab a route belongs to: its own tab, Home for the hidden routes, else none. */
export function tabForRoute(routeName: string, tabs: readonly TabDef[] = TABS): TabDef | undefined {
  const segment = routeSegment(routeName);
  const own = tabs.find((t) => t.segment === segment);
  if (own) return own;
  return HOME_ROUTES.includes(segment) ? tabs.find((t) => t.id === "home") : undefined;
}

/** The navigator route that IS a tab's root (exact segment, never a hidden route). */
export function isTabRoot(routeName: string, tab: TabDef): boolean {
  return routeSegment(routeName) === tab.segment;
}

// ── Where the tab bar hides ─────────────────────────────────────────────────
// Full-screen moments: the ticket QR, the door scanner, and the full-height
// forms (spec §5). Paths are "<tab folder>/<route name in its stack>". The
// volunteer door (app/scan) is outside the tabs and never has a bar.

export const TAB_BAR_HIDDEN_ROUTES: readonly string[] = [
  "tickets/ticket/[id]",
  "tickets/check-in/[eventId]",
  "finance/[teamId]/new",
  "finance/receipt",
  "bookings/new",
  "bookings/vehicle/[id]/[kind]",
  "me/edit",
  "me/household-member",
];

type NavState = { index?: number; routes: readonly { name: string; state?: unknown }[] };

/**
 * "tickets/ticket/[id]" for the focused screen: the tab route's name followed
 * by the focused route of each nested navigator. Index routes drop out, so a
 * tab root reads as just its folder ("tickets").
 */
export function focusedPath(state: NavState): string {
  const parts: string[] = [];
  let current: NavState | undefined = state;
  while (current && current.routes.length > 0) {
    const route: NavState["routes"][number] = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    parts.push(route.name);
    current = route.state as NavState | undefined;
  }
  return parts
    .flatMap((p) => p.split("/"))
    .filter((p, i, all) => !(p === "index" && i > 0) || all.length === 1)
    .join("/");
}

export function hidesTabBar(path: string): boolean {
  return TAB_BAR_HIDDEN_ROUTES.includes(path);
}

export function visibleTabs(me: Me | null, tabs: readonly TabDef[] = TABS): TabDef[] {
  return tabs.filter((t) => !t.visible || t.visible(me));
}
