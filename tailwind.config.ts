import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  // Class strategy so a `dark` class can be set deliberately. It is not set
  // on <html> by default, so legacy `dark:` variants stay inert.
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // shadcn utilities. `border` is the hex token (not an HSL triplet).
        // `accent` here is the hover wash, not the yellow brand accent —
        // yellow is `yellow` / `var(--accent)` and is a fill only.
        border: "var(--border)",
        input: "var(--border-strong)",
        ring: "var(--link)",
        background: "var(--bg)",
        foreground: "var(--text)",
        primary: { DEFAULT: "var(--brand-black)", foreground: "var(--bg)" },
        secondary: { DEFAULT: "var(--bg-subtle)", foreground: "var(--text-secondary)" },
        destructive: { DEFAULT: "var(--danger)", foreground: "var(--bg)" },
        muted: { DEFAULT: "var(--bg-subtle)", foreground: "var(--text-tertiary)" },
        accent: { DEFAULT: "var(--bg-subtle)", foreground: "var(--text)" },
        popover: { DEFAULT: "var(--bg)", foreground: "var(--text)" },
        card: { DEFAULT: "var(--bg)", foreground: "var(--text)" },

        bg: "var(--bg)",
        "bg-subtle": "var(--bg-subtle)",
        "brand-black": "var(--brand-black)",
        // Brand bone (#C5C2AE) is `bone-brand` / `var(--bone)`, for solid black
        // only. The legacy `bg-bone` utility is the light paper (--bg-subtle)
        // so unmigrated screens do not paint brand bone on white.
        bone: {
          DEFAULT: "var(--bg-subtle)",
          2: "var(--bg-subtle)",
          3: "var(--border)",
          brand: "var(--bone)",
        },
        rule: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
        yellow: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)", dim: "#FFF4D9" },
        grass: { DEFAULT: "var(--success)", text: "var(--success-text)" },
        amber: { DEFAULT: "var(--warning)", border: "var(--warning)" },
        electric: "var(--link)",
        link: "var(--link)",
        success: { DEFAULT: "var(--success)", text: "var(--success-text)" },
        warning: "var(--warning)",
        danger: "var(--danger)",
        ink: "var(--brand-black)",
        surface: {
          1: "var(--bg)",
          2: "var(--bg-subtle)",
          3: "var(--bg-subtle)",
          4: "var(--border)",
        },
      },
      borderRadius: {
        none: "0",
        sm: "var(--radius)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-card)",
        xl: "var(--radius-card)",
        "2xl": "12px",
        "3xl": "16px",
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
