import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  // The hub is light only. Keeping the "class" strategy (with no `dark` class
  // ever set on <html>) keeps legacy dark: variants permanently inert —
  // omitting it would flip them to media strategy and follow the OS theme.
  darkMode: "class",
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

        // Brand — use these directly: bg-ink, text-yellow, border-rule
        ink: "#0A0A0A",
        bone: { DEFAULT: "#F4F2EA", 2: "#F1EFE7", 3: "#E7E4D9" },
        rule: { DEFAULT: "#DEDACE", strong: "#C7C3B5" },
        yellow: { DEFAULT: "#FFB801", dim: "#FFF4D9" },
        grass: { DEFAULT: "#3E7F2B", text: "#2F6620" },
        amber: { DEFAULT: "#8A6400", border: "#B98600" },
        electric: "#000DE5",
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
