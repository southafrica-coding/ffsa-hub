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
        // rgb(var(--x-rgb) / <alpha-value>) so bg-primary/90 and bg-ink/40 emit.
        // `accent` is the hover wash, not the yellow fill.
        border: "rgb(var(--border-rgb) / <alpha-value>)",
        input: "rgb(var(--border-strong-rgb) / <alpha-value>)",
        ring: "rgb(var(--link-rgb) / <alpha-value>)",
        background: "rgb(var(--bg-rgb) / <alpha-value>)",
        foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--brand-black-rgb) / <alpha-value>)",
          foreground: "rgb(var(--bg-rgb) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-secondary-rgb) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--danger-rgb) / <alpha-value>)",
          foreground: "rgb(var(--bg-rgb) / <alpha-value>)",
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

        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        "bg-subtle": "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
        "brand-black": "rgb(var(--brand-black-rgb) / <alpha-value>)",
        bone: {
          DEFAULT: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          2: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          3: "rgb(var(--border-rgb) / <alpha-value>)",
          brand: "rgb(var(--bone-rgb) / <alpha-value>)",
        },
        rule: {
          DEFAULT: "rgb(var(--border-rgb) / <alpha-value>)",
          strong: "rgb(var(--border-strong-rgb) / <alpha-value>)",
        },
        yellow: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--accent-hover-rgb) / <alpha-value>)",
          dim: "rgb(var(--yellow-dim-rgb) / <alpha-value>)",
        },
        grass: {
          DEFAULT: "rgb(var(--success-rgb) / <alpha-value>)",
          text: "rgb(var(--success-text-rgb) / <alpha-value>)",
        },
        amber: {
          DEFAULT: "rgb(var(--warning-rgb) / <alpha-value>)",
          border: "rgb(var(--warning-rgb) / <alpha-value>)",
        },
        electric: "rgb(var(--link-rgb) / <alpha-value>)",
        link: "rgb(var(--link-rgb) / <alpha-value>)",
        success: {
          DEFAULT: "rgb(var(--success-rgb) / <alpha-value>)",
          text: "rgb(var(--success-text-rgb) / <alpha-value>)",
        },
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        ink: "rgb(var(--brand-black-rgb) / <alpha-value>)",
        surface: {
          1: "rgb(var(--bg-rgb) / <alpha-value>)",
          2: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          3: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
          4: "rgb(var(--border-rgb) / <alpha-value>)",
        },
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
