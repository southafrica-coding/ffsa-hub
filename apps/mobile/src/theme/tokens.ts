// FFSA Hub design tokens for the phone app ("MOVEMENT, QUIET", adapted for
// native). Single source of truth: tailwind.config.ts and the component kit
// both read from here, so change a value once.
//
// Pure data, no React Native imports: tailwind.config.ts loads this file in
// Node at build time.

// ── Raw palette (from the web app's globals.css / CLAUDE.md) ────────────────

export const palette = {
  ink: "#0A0A0A",
  white: "#FFFFFF",
  bone: "#F4F2EA",
  bone2: "#F1EFE7",
  bone3: "#E7E4D9",
  rule: "#DEDACE",
  ruleStrong: "#C7C3B5",
  textSecondary: "#45423B",
  // Below 4.5:1 on white: large text, decoration and placeholders only,
  // never body-size copy (tokens.test.ts enforces the ratios).
  textTertiary: "#7C786C",
  textQuiet: "#9A9689",
  // The single accent. ONE yellow "needs you" band per screen, black text on it.
  yellow: "#FFB801",
  yellowDim: "#FFF4D9",
  green: "#3E7F2B",
  greenText: "#2F6620",
  amber: "#8A6400",
  amberBorder: "#B98600",
  destructive: "#B02929",
  // Brand blue: kept for completeness, deliberately unused in-app.
  blue: "#000DE5",
  // Dark theme (new, proposed: the web is light-only today).
  darkBg: "#0A0A0A",
  darkSurface: "#161614",
  darkRule: "#2A2924",
  darkText: "#F4F2EA",
} as const;

// ── Semantic colours, per colour scheme ─────────────────────────────────────

export type ColorScheme = "light" | "dark";

export type SemanticColors = {
  bg: string;
  surface: string;
  surfaceStrong: string;
  rule: string;
  ruleStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textQuiet: string;
  accent: string;
  onAccent: string;
  accentDim: string;
  positive: string;
  positiveText: string;
  attention: string;
  attentionBorder: string;
  danger: string;
  inverse: string;
  onInverse: string;
};

export const colors: Record<ColorScheme, SemanticColors> = {
  light: {
    bg: palette.white,
    surface: palette.bone,
    surfaceStrong: palette.bone3,
    rule: palette.rule,
    ruleStrong: palette.ruleStrong,
    text: palette.ink,
    textSecondary: palette.textSecondary,
    textTertiary: palette.textTertiary,
    textQuiet: palette.textQuiet,
    accent: palette.yellow,
    onAccent: palette.ink,
    accentDim: palette.yellowDim,
    positive: palette.green,
    positiveText: palette.greenText,
    attention: palette.amber,
    attentionBorder: palette.amberBorder,
    danger: palette.destructive,
    inverse: palette.ink,
    onInverse: palette.white,
  },
  // Proposed. bg/surface/rule/text/accent come from design-tokens.md; the
  // status colours are lightened so they keep contrast on near-black
  // (checked in tokens.test.ts) and still need a design review.
  // Dark-only values (docs/dark-mode.md): ruleStrong is 3:1 on bg so input
  // and switch outlines don't vanish on near-black; textQuiet (placeholders)
  // and danger are 4.5:1 on every dark surface.
  dark: {
    bg: palette.darkBg,
    surface: palette.darkSurface,
    surfaceStrong: palette.darkRule,
    rule: palette.darkRule,
    ruleStrong: "#6B675D",
    text: palette.darkText,
    textSecondary: palette.ruleStrong,
    textTertiary: palette.textQuiet,
    textQuiet: "#858175",
    accent: palette.yellow,
    // Yellow always carries black text, in both schemes.
    onAccent: palette.ink,
    accentDim: "#2A2210",
    positive: "#6FB356",
    positiveText: "#8BC777",
    attention: "#D9A520",
    attentionBorder: palette.amberBorder,
    danger: "#EB7070",
    inverse: palette.darkText,
    onInverse: palette.ink,
  },
};

// ── Shape, size, motion ─────────────────────────────────────────────────────

// The web is square (radius 0). Jack hasn't chosen the app's radius yet, so
// every rounded corner in the app reads `radius.default`: change it here.
export const radius = {
  none: 0,
  sm: 2,
  md: 4,
  default: 2,
} as const;

// Minimum touch target (dp). Matches the web's mobile tab bar.
export const touch = { minTarget: 48 } as const;

export const hairline = 1;

export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
} as const;

// ── Type ────────────────────────────────────────────────────────────────────

// Font family names as registered by @expo-google-fonts (see src/theme/fonts.ts).
// Custom fonts on native don't synthesise weights, so each weight is its own family.
export const fontFamily = {
  body: "Roboto_400Regular",
  bodyMedium: "Roboto_500Medium",
  bodyBold: "Roboto_700Bold",
  display: "RobotoCondensed_900Black",
  mono: "RobotoMono_500Medium",
  monoBold: "RobotoMono_700Bold",
} as const;

// Sizes in dp. All Text scales with the OS font-size setting (allowFontScaling).
// Labels never go below 11 (the web's 9–10px mono labels are too small on a phone).
export const fontSize = {
  label: 11,
  caption: 13,
  body: 16,
  bodyLarge: 18,
  title: 22,
  display: 34,
  displayLarge: 48,
} as const;

export const MIN_LABEL_SIZE = fontSize.label;

// Display type is tight; mono labels are tracked wide (0.1–0.2em on web).
export const lineHeight = {
  display: 0.95,
  body: 1.45,
} as const;

export const letterSpacingEm = {
  display: -0.01,
  label: 0.14,
} as const;
