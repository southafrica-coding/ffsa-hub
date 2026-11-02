import type { Config } from "tailwindcss";

import { colors, fontFamily, fontSize, palette, radius, touch } from "./src/theme/tokens";

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
  // Raw brand names for the rare one-off (`bg-bone`, `border-rule`).
  ink: palette.ink,
  white: palette.white,
  bone: palette.bone,
  "bone-2": palette.bone2,
  "bone-3": palette.bone3,
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
      sm: `${radius.sm}px`,
      md: `${radius.md}px`,
      DEFAULT: `${radius.default}px`,
    },
    fontFamily: {
      sans: [fontFamily.body],
      "sans-medium": [fontFamily.bodyMedium],
      "sans-bold": [fontFamily.bodyBold],
      display: [fontFamily.display],
      mono: [fontFamily.mono],
      "mono-bold": [fontFamily.monoBold],
    },
    extend: {
      fontSize: {
        label: `${fontSize.label}px`,
        caption: `${fontSize.caption}px`,
        body: `${fontSize.body}px`,
        "body-lg": `${fontSize.bodyLarge}px`,
        title: `${fontSize.title}px`,
        display: `${fontSize.display}px`,
        "display-lg": `${fontSize.displayLarge}px`,
      },
      minHeight: { target: `${touch.minTarget}px` },
      minWidth: { target: `${touch.minTarget}px` },
    },
  },
  plugins: [],
} satisfies Config;
