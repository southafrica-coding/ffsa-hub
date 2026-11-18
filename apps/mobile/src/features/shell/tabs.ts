// The five tabs and who sees them. Route-folder contract (README):
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

export function tabForRoute(routeName: string, tabs: readonly TabDef[] = TABS): TabDef | undefined {
  const segment = routeSegment(routeName);
  return tabs.find((t) => t.segment === segment);
}

export function visibleTabs(me: Me | null, tabs: readonly TabDef[] = TABS): TabDef[] {
  return tabs.filter((t) => !t.visible || t.visible(me));
}
