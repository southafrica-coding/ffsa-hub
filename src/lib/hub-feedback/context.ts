// "Where were they?" — maps the page someone sent feedback from onto the
// Hub module it belongs to, using the same nav config as the sidebar.
// Client-safe (the feedback form calls it with usePathname()).

import { ADMIN_MODULES, SYSTEM_MODULES, PORTAL_TABS } from "@/config/modules";

export function moduleForPath(pathname: string): { id: string; label: string } | null {
  const all = [...ADMIN_MODULES, ...SYSTEM_MODULES, ...PORTAL_TABS].map((m) => ({
    id: m.id,
    label: m.label,
    href: m.href,
  }));
  const match = all
    .filter((m) => pathname === m.href || pathname.startsWith(m.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? { id: match.id, label: match.label } : null;
}

export function moduleLabelFor(id: string): string | null {
  return feedbackModuleOptions().find((m) => m.id === id)?.label ?? null;
}

/** Every module a piece of feedback can be filed under, for the board's filter. */
export function feedbackModuleOptions(): { id: string; label: string }[] {
  const seen = new Set<string>();
  return [...ADMIN_MODULES, ...SYSTEM_MODULES, ...PORTAL_TABS]
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .map((m) => ({ id: m.id, label: m.label }));
}
