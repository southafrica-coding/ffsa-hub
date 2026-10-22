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
  if (!match) return null;
  return { id: match.id, label: moduleLabelFor(match.id) ?? match.label };
}

export function moduleLabelFor(id: string): string | null {
  return feedbackModuleOptions().find((m) => m.id === id)?.label ?? null;
}

/** Every module a piece of feedback can be filed under, for the board's filter. */
export function feedbackModuleOptions(): { id: string; label: string }[] {
  // Personal tabs share labels with modules ("Finance", "Training"), so
  // they're marked as the person's own.
  return [
    ...[...ADMIN_MODULES, ...SYSTEM_MODULES].map((m) => ({ id: m.id, label: m.label })),
    ...PORTAL_TABS.map((t) => ({
      id: t.id,
      label: t.label.startsWith("My ") ? t.label : `My ${t.label.toLowerCase()}`,
    })),
  ];
}
