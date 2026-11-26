// The org chart's colours: frame 40b's dark canvas with the yellow accent
// (Jack, 2026-10-19). One palette, read two ways:
//   T.*            hex values, for inline styles and SVG strokes
//   var(--org-*)   the same values as CSS variables, set on the chart's root
//                  by ORG_VARS, for Tailwind classes such as
//                  bg-[color:var(--org-surface)]
// The rest of the Hub stays light; only the chart's own root is dark.

import type { CSSProperties } from "react";
import type { OrgState } from "@/lib/org-chart/model";

const P = {
  frame: "#121211", // page behind the chart, top bar
  canvas: "#0C0C0B",
  dots: "#2A2925",
  zone: "#2E2D29",
  surface: "#1A1A18", // tables, drawer body, panels
  drawer: "#161615",
  border: "#3A3935",
  head: "#262522", // table header
  headInk: "#F4F2EA",
  headMono: "#8E8A7C",
  section: "#262522", // section bars in drawers
  sectionInk: "#F4F2EA",
  row: "#26251F", // hairline between rows
  ink: "#F4F2EA", // primary text
  onInk: "#121211", // text on an ink-filled button
  sub: "#A8A496",
  mono: "#8E8A7C",
  edge: "#36352F",
  edgeOn: "#F4F2EA",
  track: "#2A2925",
  btnBorder: "#3A3935",
  open: "#FFB801", // "not named yet" and other gaps
  openBg: "#221D0E",
  hover: "#232220",
  yellow: "#FFB801",
  onYellow: "#0A0A0A", // text on the yellow accent — always dark
  danger: "#F97066",
} as const;

export const T = {
  ...P,
  dotsBg: `radial-gradient(${P.dots} 1px, transparent 1px)`,
  st: {
    complete: { dot: "#F4F2EA", color: "#0A0A0A", bg: "#F4F2EA", border: "#F4F2EA" },
    moving: { dot: "#6FB85A", color: "#7FC46A", bg: "transparent", border: "#3E7F2B" },
    progress: { dot: "#8E8A7C", color: "#C5C2AE", bg: "transparent", border: "#4A4843" },
    stuck: { dot: "#FFB801", color: "#FFB801", bg: "transparent", border: "#8A6400" },
    notstarted: { dot: "#3A3935", color: "#8E8A7C", bg: "transparent", border: "#3A3935" },
  } as Record<OrgState, { dot: string; color: string; bg: string; border: string }>,
};

/** CSS variables for the chart root, so Tailwind classes can use the palette. */
export const ORG_VARS = Object.fromEntries(
  Object.entries(P).map(([k, v]) => [`--org-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`, v])
) as CSSProperties;

/**
 * The Hub's global form styles (globals.css) force light inputs with
 * !important and a (0,3,1) selector. Inside the dark chart, out-rank them.
 */
export const ORG_CSS = `
.org-theme input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
.org-theme textarea,
.org-theme select {
  background: var(--org-surface) !important;
  color: var(--org-ink) !important;
  border-color: var(--org-border) !important;
}
.org-theme input::placeholder, .org-theme textarea::placeholder { color: var(--org-mono) !important; }
.org-theme select option { background: var(--org-surface); color: var(--org-ink); }
.org-theme h1, .org-theme h2, .org-theme h3 { color: var(--org-ink) !important; }

/* While the dark chart is on the page, the Hub's own shell goes dark with it
   (Jack, 2026-10-19). :has() rather than a script, so there is no flash of
   cream on load and nothing to undo on the way out: leave the page and the
   rule no longer matches. */
body:has(.org-theme) [data-shell-main] { background: ${P.frame} !important; }
body:has(.org-theme) [data-shell-panel] { background: ${P.drawer} !important; color: ${P.ink}; }
body:has(.org-theme) [data-shell-panel] * { border-color: ${P.border} !important; }
body:has(.org-theme) [data-shell-panel] :is(.text-ink, [class*="text-[color:var(--text-strong)]"], [class*="text-[color:var(--text-secondary)]"]) { color: ${P.ink} !important; }
body:has(.org-theme) [data-shell-panel] .mono-label { color: ${P.mono} !important; }
body:has(.org-theme) [data-shell-panel] [class*="text-[color:var(--text-secondary)]"] { color: ${P.sub} !important; }
body:has(.org-theme) [data-shell-panel] a:not([data-active]):hover,
body:has(.org-theme) [data-shell-panel] button:hover { background: ${P.hover} !important; }
body:has(.org-theme) [data-shell-panel] a[data-active] { background: ${P.yellow} !important; color: ${P.onYellow} !important; }
body:has(.org-theme) [data-shell-panel] .bg-ink { background: ${P.head} !important; }
`;
