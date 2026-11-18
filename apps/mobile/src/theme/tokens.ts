// FFSA Hub design tokens for the phone app (iPhone redesign, 18 Nov 2026:
// ~/CODING/mobile-prompts/redesign/design-spec.md §2). Single source of
// truth: tailwind.config.ts and the component kit both read from here, so
// change a value once.
//
// Pure data, no React Native imports: tailwind.config.ts loads this file in
// Node at build time.

// ── Raw palette ─────────────────────────────────────────────────────────────

export const palette = {
  ink: "#0A0A0A",
  white: "#FFFFFF",
  // The web's warm paper. In the app it is the dark scheme's text colour
  // only; it is no longer a light surface (redesign).
  paper: "#F4F2EA",
  // bg-subtle: the light scheme's warm surface (list groups, banners, tracks).
  subtle: "#FBFAF7",
  rule: "#E7E4D9",
  // 3.46:1 on white: input, switch and chip outlines (WCAG 1.4.11).
  ruleStrong: "#8E8A7C",
  textSecondary: "#55524A",
  // 5.6:1 on white: captions, chevrons and placeholders all pass AA.
  textTertiary: "#6B675D",
  // The single accent. A FILL with black text, never text on white. ONE
  // yellow "needs you" band per screen.
  yellow: "#FFB801",
  yellowPressed: "#FFCB3D",
  yellowDim: "#FFF4D9",
  green: "#3E7F2B",
  amber: "#8A6400",
  amberBorder: "#B98600",
  destructive: "#D92D20",
  // Focus ring on paper (rare). Brand blue, otherwise unused in-app.
  blue: "#000DE5",
  // Text on black only (scanner captions). Never on white, never a fill.
  bone: "#C5C2AE",
  // Dark scheme.
  darkBg: "#0A0A0A",
  darkSurface: "#161614",
  darkRule: "#2A2924",
  darkRuleStrong: "#6B675D",
  darkTextSecondary: "#C7C3B5",
  darkTextQuiet: "#858175",
  // Pressed ink (light primary buttons).
  inkPressed: "#2A2924",
} as const;

// ── Semantic colours, per colour scheme ─────────────────────────────────────

export type ColorScheme = "light" | "dark";

export type SemanticColors = {
  /** Page canvas and the tab bar. */
  bg: string;
  /** bg-subtle: list groups, banners, segmented tracks, pressed rows. */
  surface: string;
  /** Pressed fills and skeleton blocks. */
  surfaceStrong: string;
  /** Sheets, text fields: white in light, the dark surface in dark. */
  raised: string;
  /** The selected segment of a SegmentedControl. */
  segmentOn: string;
  rule: string;
  ruleStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Placeholders. */
  textQuiet: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentDim: string;
  /** Primary button: ink/white in light, yellow/black in dark (spec §1). */
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  positive: string;
  onPositive: string;
  positiveText: string;
  attention: string;
  attentionBorder: string;
  danger: string;
  onDanger: string;
  inverse: string;
  onInverse: string;
  /** Focused text field outline. */
  focus: string;
  /** Text on black only (scanner captions). */
  bone: string;
  /** Sheet backdrop. */
  scrim: string;
};

export const colors: Record<ColorScheme, SemanticColors> = {
  light: {
    bg: palette.white,
    surface: palette.subtle,
    surfaceStrong: palette.rule,
    raised: palette.white,
    segmentOn: palette.white,
    rule: palette.rule,
    ruleStrong: palette.ruleStrong,
    text: palette.ink,
    textSecondary: palette.textSecondary,
    textTertiary: palette.textTertiary,
    textQuiet: palette.textTertiary,
    accent: palette.yellow,
    accentPressed: palette.yellowPressed,
    onAccent: palette.ink,
    accentDim: palette.yellowDim,
    primary: palette.ink,
    primaryPressed: palette.inkPressed,
    onPrimary: palette.white,
    positive: palette.green,
    onPositive: palette.white,
    positiveText: palette.green,
    attention: palette.amber,
    attentionBorder: palette.amberBorder,
    danger: palette.destructive,
    onDanger: palette.white,
    inverse: palette.ink,
    onInverse: palette.white,
    focus: palette.blue,
    bone: palette.bone,
    scrim: "rgba(10, 10, 10, 0.42)",
  },
  // The status colours are lightened so they keep contrast on near-black
  // (checked in tokens.test.ts / contrast.test.ts). ruleStrong is 3:1 on bg so
  // input and switch outlines don't vanish; textQuiet (placeholders) and
  // danger are 4.5:1 on every dark surface.
  dark: {
    bg: palette.darkBg,
    surface: palette.darkSurface,
    surfaceStrong: palette.darkRule,
    raised: palette.darkSurface,
    segmentOn: palette.darkRule,
    rule: palette.darkRule,
    ruleStrong: palette.darkRuleStrong,
    text: palette.paper,
    textSecondary: palette.darkTextSecondary,
    textTertiary: palette.darkTextSecondary,
    textQuiet: palette.darkTextQuiet,
    accent: palette.yellow,
    accentPressed: palette.yellowPressed,
    // Yellow always carries black text, in both schemes.
    onAccent: palette.ink,
    accentDim: "#2A2210",
    primary: palette.yellow,
    primaryPressed: palette.yellowPressed,
    onPrimary: palette.ink,
    positive: "#6FB356",
    onPositive: palette.ink,
    positiveText: "#8BC777",
    attention: "#D9A520",
    attentionBorder: palette.amberBorder,
    danger: "#EB7070",
    onDanger: palette.ink,
    inverse: palette.paper,
    onInverse: palette.ink,
    focus: palette.yellow,
    bone: palette.bone,
    scrim: "rgba(0, 0, 0, 0.66)",
  },
};

// ── Shape, size, motion ─────────────────────────────────────────────────────

// Controls (buttons, fields, chips, segments) are 6pt; cards, list groups,
// sheets and the yellow band are 8pt. `none` for the rare square edge.
export const radius = {
  none: 0,
  control: 6,
  card: 8,
} as const;

// Minimum touch target (dp). 44 is the floor (segmented controls); 48 for
// the tab bar and standalone targets.
export const touch = { minTarget: 48, floor: 44 } as const;

export const hairline = 1;

// Spacing scale (spec): page gutter 16–20.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  gutter: 20,
  inset: 16,
} as const;

export const motion = {
  press: 100,
  fast: 150,
  fade: 160,
  base: 200,
  slow: 250,
} as const;

// ── Type ────────────────────────────────────────────────────────────────────

// Font family names as registered by @expo-google-fonts (see src/theme/fonts.ts).
// Custom fonts on native don't synthesise weights, so each weight is its own family.
export const fontFamily = {
  body: "Roboto_400Regular",
  bodyMedium: "Roboto_500Medium",
  bodySemibold: "Roboto_600SemiBold",
  bodyBold: "Roboto_700Bold",
  bodyExtraBold: "Roboto_800ExtraBold",
  // Page titles and the hero: Roboto 900 (was Roboto Condensed 900).
  display: "Roboto_900Black",
  // Helper notes only.
  condensed: "RobotoCondensed_400Regular",
  mono: "RobotoMono_500Medium",
  monoBold: "RobotoMono_700Bold",
} as const;

// Sizes in dp. All Text scales with the OS font-size setting (allowFontScaling).
// Nothing goes below 11.
export const fontSize = {
  monoLabel: 11,
  tab: 11,
  eyebrow: 12,
  chip: 12,
  caption: 13,
  label: 13,
  note: 14,
  sectionTitle: 15,
  body: 16,
  navTitle: 16,
  sheetTitle: 17,
  title: 20,
  kpi: 24,
  pageTitle: 28,
  hero: 34,
  numeral: 40,
} as const;

export const MIN_LABEL_SIZE = 11;

export const letterSpacingEm = {
  display: -0.01,
  eyebrow: 0.06,
  label: 0.14,
} as const;
