// Token -> style mapping for the component kit. Pure functions (no hooks), so
// the mapping is unit-tested in tokens.test.ts and the components stay thin.

import type { TextStyle, ViewStyle } from "react-native";

import {
  fontFamily,
  fontSize,
  hairline,
  letterSpacingEm,
  lineHeight,
  radius,
  touch,
  type ColorScheme,
  type SemanticColors,
} from "./tokens";

// ── Text ────────────────────────────────────────────────────────────────────

export type TextVariant = "display" | "title" | "numeral" | "body" | "bodyStrong" | "caption" | "label";

export type TextTone =
  | "default"
  | "secondary"
  | "tertiary"
  | "quiet"
  | "danger"
  | "positive"
  | "attention"
  | "onAccent"
  | "onInverse";

const textVariants: Record<TextVariant, TextStyle> = {
  // Roboto Condensed 900, uppercase, tight leading.
  display: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.display,
    lineHeight: Math.round(fontSize.display * lineHeight.display),
    letterSpacing: fontSize.display * letterSpacingEm.display,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.title,
    lineHeight: Math.round(fontSize.title * 1.05),
    textTransform: "uppercase",
  },
  // The "one big number per screen".
  numeral: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.displayLarge,
    lineHeight: Math.round(fontSize.displayLarge * lineHeight.display),
    fontVariant: ["tabular-nums"],
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  bodyStrong: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  caption: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.caption,
    lineHeight: Math.round(fontSize.caption * lineHeight.body),
  },
  // Roboto Mono caps, wide tracking, never below 11.
  label: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.label,
    lineHeight: Math.round(fontSize.label * 1.4),
    letterSpacing: fontSize.label * letterSpacingEm.label,
    textTransform: "uppercase",
  },
};

const toneColor: Record<TextTone, keyof SemanticColors> = {
  default: "text",
  secondary: "textSecondary",
  tertiary: "textTertiary",
  quiet: "textQuiet",
  danger: "danger",
  positive: "positiveText",
  attention: "attention",
  onAccent: "onAccent",
  onInverse: "onInverse",
};

export function textStyle(variant: TextVariant, tone: TextTone, c: SemanticColors): TextStyle {
  return { ...textVariants[variant], color: c[toneColor[tone]] };
}

// Big display type can't grow without limit or it stops fitting; body text
// follows the OS setting fully.
export const maxFontScale: Record<TextVariant, number | undefined> = {
  display: 1.4,
  title: 1.6,
  numeral: 1.4,
  body: undefined,
  bodyStrong: undefined,
  caption: undefined,
  label: 2,
};

// ── Button ──────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export function buttonStyle(
  variant: ButtonVariant,
  c: SemanticColors,
  state: { pressed: boolean; disabled: boolean },
): { container: ViewStyle; tone: TextTone; textColor: string } {
  const base: ViewStyle = {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    paddingHorizontal: 20,
    borderRadius: radius.default,
    borderWidth: hairline,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    opacity: state.disabled ? 0.45 : 1,
  };
  switch (variant) {
    case "primary":
      return {
        container: {
          ...base,
          backgroundColor: state.pressed ? c.textSecondary : c.inverse,
          borderColor: c.inverse,
        },
        tone: "onInverse",
        textColor: c.onInverse,
      };
    case "secondary":
      return {
        container: {
          ...base,
          backgroundColor: state.pressed ? c.surfaceStrong : "transparent",
          borderColor: c.text,
        },
        tone: "default",
        textColor: c.text,
      };
    case "ghost":
      return {
        container: {
          ...base,
          paddingHorizontal: 8,
          backgroundColor: state.pressed ? c.surface : "transparent",
          borderColor: "transparent",
        },
        tone: "default",
        textColor: c.text,
      };
    case "destructive":
      return {
        container: {
          ...base,
          backgroundColor: state.pressed ? c.surfaceStrong : "transparent",
          borderColor: c.danger,
        },
        tone: "danger",
        textColor: c.danger,
      };
  }
}

// ── Banner ──────────────────────────────────────────────────────────────────

// "needsYou" is THE yellow band: at most one per screen (Screen warns in dev).
export type BannerTone = "needsYou" | "info" | "positive" | "danger";

export function bannerStyle(tone: BannerTone, c: SemanticColors): { container: ViewStyle; text: TextTone } {
  const base: ViewStyle = { paddingHorizontal: 16, paddingVertical: 14, gap: 4, borderRadius: radius.none };
  switch (tone) {
    case "needsYou":
      return {
        container: { ...base, backgroundColor: c.accent, borderWidth: 2, borderColor: c.onAccent },
        text: "onAccent",
      };
    case "info":
      return {
        container: { ...base, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.rule },
        text: "default",
      };
    case "positive":
      return {
        container: { ...base, backgroundColor: c.bg, borderWidth: hairline, borderColor: c.rule, borderLeftWidth: 3, borderLeftColor: c.positive },
        text: "default",
      };
    case "danger":
      return {
        container: { ...base, backgroundColor: c.bg, borderWidth: hairline, borderColor: c.rule, borderLeftWidth: 3, borderLeftColor: c.danger },
        text: "default",
      };
  }
}

// ── Native controls that take colours as props ──────────────────────────────

/**
 * Pull-to-refresh spinner. iOS reads tintColor; Android draws `colors` on a
 * disc of `progressBackgroundColor`, which is white unless set, so a light
 * arrow would vanish on it in dark mode.
 */
export function refreshControlColors(c: SemanticColors) {
  return { tintColor: c.text, colors: [c.text], progressBackgroundColor: c.surface };
}

/**
 * Switch colours. Light keeps the white thumb. In dark the thumb would be
 * near-black on a near-black screen when off, so it turns light grey (off)
 * or ink on the bone track (on). State is also in the row's words/role.
 */
export function switchColors(c: SemanticColors, scheme: ColorScheme, value: boolean) {
  return {
    trackColor: { false: c.ruleStrong, true: c.text },
    ios_backgroundColor: c.ruleStrong,
    thumbColor: scheme === "dark" ? (value ? c.onInverse : c.textSecondary) : c.bg,
  };
}
