// URL building for the space-bookings screen.
//
// Extracted from the view component because of a bug that is invisible in a
// component test but breaks the screen for two hours every night: see
// buildSpacesHref below.

export type SpacesViewKind = "month" | "week" | "day" | "list";

export type SpacesNavState = {
  view: SpacesViewKind;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Venue id, or "all". */
  venue: string;
  /** Ministry id, or "all". */
  ministry: string;
};

/** The view the module lands on, and so the one left out of the query string. */
export const DEFAULT_SPACES_VIEW: SpacesViewKind = "day";

/**
 * Build the href for a change of view / date / filter.
 *
 * The date is ALWAYS written out, even when it is the viewer's today. It used
 * to be omitted as a tidy-URL optimisation, which quietly broke "next day":
 *
 *   The page renders on the server, so an omitted date resolves to the
 *   SERVER's today — UTC on Vercel. The button that builds the link runs in
 *   the browser, on the viewer's today — UTC+2 in South Africa. Between
 *   22:00 and midnight SAST those are different days: the server renders the
 *   18th, the browser thinks today is the 19th, so "next day" computes the
 *   19th, matches the browser's today, drops the parameter — and the server
 *   serves the 18th again. Forward did nothing; back worked fine.
 *
 * Never reintroduce the shortcut. Any "is this today" test that spans a server
 * render and a client click is comparing two different clocks.
 */
export function buildSpacesHref(state: SpacesNavState): string {
  const sp = new URLSearchParams();
  if (state.view && state.view !== DEFAULT_SPACES_VIEW) sp.set("view", state.view);
  if (state.date) sp.set("date", state.date);
  if (state.venue && state.venue !== "all") sp.set("venue", state.venue);
  if (state.ministry && state.ministry !== "all") sp.set("ministry", state.ministry);
  const qs = sp.toString();
  return `/bookings/spaces${qs ? `?${qs}` : ""}`;
}
