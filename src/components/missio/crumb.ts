/** Section names for the Missio top bar. Longer prefixes are listed first. */
export const MISSIO_CRUMB_LABELS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "/missio/house-churches", label: "House churches" },
  { prefix: "/missio/follow-up", label: "Follow-up" },
  { prefix: "/missio/volunteers", label: "Volunteers" },
  // The pastor grid preview is the Volunteers page with fixture data (board M6c).
  { prefix: "/serve/missio/preview/pastor", label: "Volunteers" },
  { prefix: "/missio/people", label: "People" },
  { prefix: "/missio/next-leaders", label: "Next leaders" },
  { prefix: "/missio/care", label: "Care" },
  { prefix: "/missio/sundays", label: "Sundays" },
  { prefix: "/missio/calendar", label: "Calendar" },
];

/** The section after "Missio /" for a pathname. Home is the fallback. */
export function missioCrumbLabel(pathname: string): string {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "";
  const match = MISSIO_CRUMB_LABELS.find((item) => path === item.prefix || path.startsWith(`${item.prefix}/`));
  return match?.label ?? "Home";
}
