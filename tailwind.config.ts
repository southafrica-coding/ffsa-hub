import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

// A colour token backed by a CSS variable holding "R G B" channels, so
// opacity modifiers (bg-ink/40) keep working.
const tok = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  // Each person picks Light or Dark on their profile (migration 344). The
  // choice lands as a `dark` class on <html> before the page paints (see
  // src/lib/theme). `dark:` variants follow it, except inside a .theme-light
  // block, which keeps its light look in both modes (the black rail, event
  // storefronts, email previews).
  darkMode: ["variant", "&:is(.dark *):not(:is(.theme-light *))"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },

        // The surface ramp as utilities, so `bg-surface-1` resolves instead of
        // silently emitting nothing. Values track the --surface-* CSS vars,
        // which globals.css switches for dark mode.
        surface: { 1: tok("surface-1"), 2: tok("surface-2"), 3: tok("surface-3"), 4: tok("surface-4") },

        // Brand — use these directly: bg-ink, text-yellow, border-rule.
        // Each is a CSS variable so dark mode can swap it. As text and border
        // colours, ink and white mean "the strongest foreground" and "white"
        // (ink turns bone-white in dark mode). As backgrounds they mean
        // "black bar" and "page" — see backgroundColor below.
        ink: tok("ink"),
        bone: { DEFAULT: tok("bone"), 2: tok("bone-2"), 3: tok("bone-3") },
        rule: { DEFAULT: tok("rule"), strong: tok("rule-strong") },
        yellow: { DEFAULT: "#FFB801", dim: tok("yellow-dim") },
        grass: { DEFAULT: tok("grass"), text: tok("grass-text") },
        amber: { DEFAULT: tok("amber"), border: tok("amber-border") },
        electric: "#000DE5",
      },
      // Backgrounds split from text colours where dark mode needs them to
      // differ: a black bar (bg-ink) turns charcoal and keeps its white text;
      // a page or card (bg-white) turns near-black; bone text on a black bar
      // stays bone; amber and green fills stay dark enough for white text.
      backgroundColor: {
        ink: tok("ink-bg"),
        white: tok("paper"),
        amber: { DEFAULT: "#8A6400", border: "#B98600" },
        grass: { DEFAULT: "#3E7F2B", text: "#2F6620" },
      },
      textColor: {
        bone: { DEFAULT: "#F4F2EA", 2: "#F1EFE7", 3: "#E7E4D9" },
      },
      // Square by default. Every radius token resolves to 0 so a stray
      // rounded-lg in an old component cannot reintroduce corners.
      borderRadius: { none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0", full: "0" },
      // Shadows off — the system uses borders, not elevation.
      boxShadow: { none: "none", sm: "none", DEFAULT: "none", md: "none", lg: "none", xl: "none", "2xl": "none", inner: "none" },
      fontFamily: {
        // 'display' kept as the key so existing font-display usages keep working —
        // it now resolves to Roboto Condensed Black, not Bebas Neue.
        display: ["var(--font-roboto-condensed)", "'Arial Narrow'", "sans-serif"],
        sans: ["var(--font-roboto)", "'Roboto'", "sans-serif"],
        mono: ["var(--font-roboto-mono)", "monospace"],
      },
      letterSpacing: { label: "0.2em", chip: "0.12em" },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
