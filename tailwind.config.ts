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
        // rgb(var(--x-rgb) / <alpha-value>) so bg-primary/90 and bg-ink/40 emit.
        // `accent` is the hover wash, not the yellow fill.
        border: "rgb(var(--border-rgb) / <alpha-value>)",
        input: "rgb(var(--border-strong-rgb) / <alpha-value>)",
        ring: "rgb(var(--link-rgb) / <alpha-value>)",
        background: "rgb(var(--bg-rgb) / <alpha-value>)",
        foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--brand-black-rgb) / <alpha-value>)",
          // White in both modes: --bg goes near-black in dark mode.
          foreground: "rgb(255 255 255 / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-secondary-rgb) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--danger-rgb) / <alpha-value>)",
          foreground: "rgb(255 255 255 / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-tertiary-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--bg-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--bg-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        },

        // Brand tokens from main's dark-mode system: each is a CSS variable
        // holding "R G B" channels so dark mode can swap it. As text and
        // border colours, ink and white mean "the strongest foreground" and
        // "white" (ink turns bone-white in dark mode). As backgrounds they
        // mean "black bar" and "page" — see backgroundColor below.
        surface: { 1: tok("surface-1"), 2: tok("surface-2"), 3: tok("surface-3"), 4: tok("surface-4") },
        ink: tok("ink"),
        bone: { DEFAULT: tok("bone"), 2: tok("bone-2"), 3: tok("bone-3"), brand: "rgb(var(--bone-rgb) / <alpha-value>)" },
        rule: { DEFAULT: tok("rule"), strong: tok("rule-strong") },
        yellow: {
          // --accent is #FFB801 in both modes.
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--accent-hover-rgb) / <alpha-value>)",
          dim: tok("yellow-dim"),
        },
        grass: { DEFAULT: tok("grass"), text: tok("grass-text") },
        amber: { DEFAULT: tok("amber"), border: tok("amber-border") },

        // Hub semantic tokens (DS-1). html.dark swaps these too.
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        "bg-subtle": "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
        "brand-black": "rgb(var(--brand-black-rgb) / <alpha-value>)",
        electric: "rgb(var(--link-rgb) / <alpha-value>)",
        link: "rgb(var(--link-rgb) / <alpha-value>)",
        success: {
          DEFAULT: "rgb(var(--success-rgb) / <alpha-value>)",
          text: "rgb(var(--success-text-rgb) / <alpha-value>)",
        },
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
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
      borderRadius: {
        none: "0",
        sm: "var(--radius)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-card)",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-card)",
        "3xl": "var(--radius-card)",
        full: "9999px",
      },
      boxShadow: {
        none: "none",
        sm: "none",
        DEFAULT: "none",
        md: "none",
        lg: "none",
        xl: "none",
        "2xl": "none",
        inner: "none",
      },
      fontFamily: {
        // Titles and body are Roboto. Notes use `font-condensed`.
        display: ["var(--font-roboto)", "Roboto", "sans-serif"],
        sans: ["var(--font-roboto)", "Roboto", "sans-serif"],
        mono: ["var(--font-roboto-mono)", "ui-monospace", "monospace"],
        condensed: ["var(--font-roboto-condensed)", "Roboto Condensed", "sans-serif"],
      },
      fontSize: {
        caption: ["12px", { lineHeight: "16px", fontWeight: "500" }],
        ui: ["13px", { lineHeight: "20px" }],
        body: ["14px", { lineHeight: "22px" }],
        section: ["15px", { lineHeight: "22px", fontWeight: "600" }],
        "card-title": ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "page-title": ["20px", { lineHeight: "28px" }],
        hero: ["28px", { lineHeight: "36px" }],
        kpi: ["24px", { lineHeight: "32px", fontWeight: "500" }],
      },
      letterSpacing: { eyebrow: "0.06em", label: "0.06em", chip: "0.06em" },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
