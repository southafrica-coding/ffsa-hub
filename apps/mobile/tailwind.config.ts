import type { Config } from "tailwindcss";

import { colors, fontFamily, fontSize, palette, radius, space, touch } from "./src/theme/tokens";

// Semantic colours: `bg-surface`, `text-text-secondary`, … resolve to the light
// value; add the `dark:` variant with the `-dark` name (`dark:bg-surface-dark`).
// NativeWind follows the system colour scheme.
function semantic() {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors.light)) out[kebab(key)] = value;
  for (const [key, value] of Object.entries(colors.dark)) out[`${kebab(key)}-dark`] = value;
  return out;
}

function kebab(s: string) {
  return s.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);
}

export const themeColors: Record<string, string> = {
  ...semantic(),
  // Raw brand names for the rare one-off (`bg-ink`, `text-bone`). `bone` is
  // text on black only; `subtle` is the light warm surface.
  ink: palette.ink,
  white: palette.white,
  paper: palette.paper,
  subtle: palette.subtle,
  bone: palette.bone,
  yellow: palette.yellow,
  "yellow-dim": palette.yellowDim,
  transparent: "transparent",
};

export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    // Replace (not extend) colours and radii, so off-brand Tailwind defaults
    // like `bg-blue-500` or `rounded-xl` simply don't exist.
    colors: themeColors,
    borderRadius: {
      none: "0px",
      control: `${radius.control}px`,
      card: `${radius.card}px`,
      DEFAULT: `${radius.control}px`,
    },
    fontFamily: {
      sans: [fontFamily.body],
      "sans-medium": [fontFamily.bodyMedium],
      "sans-semibold": [fontFamily.bodySemibold],
      "sans-bold": [fontFamily.bodyBold],
      "sans-extrabold": [fontFamily.bodyExtraBold],
      display: [fontFamily.display],
      condensed: [fontFamily.condensed],
      mono: [fontFamily.mono],
      "mono-bold": [fontFamily.monoBold],
    },
    extend: {
      fontSize: {
        "mono-label": `${fontSize.monoLabel}px`,
        eyebrow: `${fontSize.eyebrow}px`,
        caption: `${fontSize.caption}px`,
        label: `${fontSize.label}px`,
        note: `${fontSize.note}px`,
        section: `${fontSize.sectionTitle}px`,
        body: `${fontSize.body}px`,
        kpi: `${fontSize.kpi}px`,
        "page-title": `${fontSize.pageTitle}px`,
        hero: `${fontSize.hero}px`,
      },
      spacing: { gutter: `${space.gutter}px`, inset: `${space.inset}px` },
      minHeight: { target: `${touch.minTarget}px`, floor: `${touch.floor}px` },
      minWidth: { target: `${touch.minTarget}px`, floor: `${touch.floor}px` },
    },
  },
  plugins: [],
} satisfies Config;
