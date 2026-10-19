// Equipment hire is dark (frames 44–47): one palette for the storefront and
// the staff tools. Every /bookings/equipment page sits inside `.theme-hire`,
// which sets these as CSS variables so Tailwind classes can read them, e.g.
// bg-[color:var(--hire-surface)]. The rest of the Hub stays light.

const P = {
  bg: "#100E0B",
  surface: "#17140F",
  surface2: "#1B1814",
  hover: "#221E18",
  line: "#2A251E",
  line2: "#2F2A22",
  lineStrong: "#3A3328", // input and button outlines
  ink: "#F6F0E2", // primary text
  body: "#CFC6B4",
  muted: "#8C8273",
  dim: "#5E564A",
  accent: "#FFB801",
  onAccent: "#100E0B", // text on the yellow — always dark
  ok: "#9CC48A",
  rail: "#050403",
} as const;

export const HIRE = P;

const vars = Object.entries(P)
  .map(([k, v]) => `--hire-${k.replace(/[A-Z0-9]/g, (c) => "-" + c.toLowerCase())}: ${v};`)
  .join(" ");

/**
 * Scoped styles. The Hub's base layer colours headings, links and form
 * fields for the light theme, so inside `.theme-hire` they are put back.
 * While a hire page is open, the Hub's own shell goes dark with it (same
 * :has() approach as the org chart, #448): no flash on load, nothing to undo.
 */
export const HIRE_CSS = `
.theme-hire { ${vars} background: var(--hire-bg); color: var(--hire-body); }
.theme-hire h1, .theme-hire h2, .theme-hire h3 { color: var(--hire-ink); }
.theme-hire a { color: inherit; }
.theme-hire a:hover { color: inherit; }
.theme-hire .hire-display {
  font-family: var(--font-bebas), 'Bebas Neue', sans-serif;
  font-weight: 400; text-transform: none; letter-spacing: 0.005em; line-height: 0.9;
  color: var(--hire-ink); font-variant-numeric: tabular-nums;
}
.theme-hire .hire-label {
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--hire-muted);
}
.theme-hire .hire-mono { font-family: var(--font-mono-brand), 'Roboto Mono', monospace; }
.theme-hire input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
.theme-hire textarea,
.theme-hire select {
  background: var(--hire-surface2) !important;
  color: var(--hire-ink) !important;
  border-color: var(--hire-line-strong) !important;
}
/* A field drawn inside its own box (the search bar): the box is the field. */
.theme-hire input.hire-bare:not([type="checkbox"]):not([type="radio"]):not([type="range"]) {
  background: transparent !important; border: 0 !important; padding: 0 !important;
  font-size: inherit !important; height: 100%;
}
.theme-hire input::placeholder, .theme-hire textarea::placeholder { color: var(--hire-muted) !important; }

body:has(.theme-hire) [data-shell-main] { background: ${P.bg} !important; }
body:has(.theme-hire) [data-shell-topbar] { display: none !important; }
body:has(.theme-hire) [data-shell-tabbar] { display: none !important; }
body:has(.theme-hire) [data-shell-panel] { background: ${P.surface} !important; color: ${P.ink}; }
body:has(.theme-hire) [data-shell-panel] * { border-color: ${P.line} !important; }
body:has(.theme-hire) [data-shell-panel] :is(.text-ink, [class*="text-[#2A2822]"], [class*="text-[#45423B]"]) { color: ${P.ink} !important; }
body:has(.theme-hire) [data-shell-panel] .mono-label { color: ${P.muted} !important; }
body:has(.theme-hire) [data-shell-panel] [class*="text-[color:var(--text-secondary)]"] { color: ${P.body} !important; }
body:has(.theme-hire) [data-shell-panel] a:not([data-active]):hover,
body:has(.theme-hire) [data-shell-panel] button:hover { background: ${P.hover} !important; }
body:has(.theme-hire) [data-shell-panel] a[data-active] { background: ${P.hover} !important; color: ${P.ink} !important; box-shadow: inset 3px 0 0 ${P.accent}; }
body:has(.theme-hire) [data-shell-panel] .bg-ink { background: ${P.rail} !important; }
`;
