// Token -> style mapping for the component kit. Pure functions (no hooks), so
// the mapping is unit-tested in tokens.test.ts and the components stay thin.

import type { TextStyle, ViewStyle } from "react-native";

import {
  fontFamily,
  fontSize,
  hairline,
  letterSpacingEm,
  radius,
  touch,
  type ColorScheme,
  type SemanticColors,
} from "./tokens";

// ── Text ────────────────────────────────────────────────────────────────────

/**
 * The redesign's type scale (design-spec §3). One caps moment per screen:
 * pageTitle (or hero) plus its eyebrow. In-content labels are `label`,
 * sentence case.
 */
export type TextVariantNew =
  | "eyebrow"
  | "label"
  | "monoLabel"
  | "caption"
  | "body"
  | "sectionTitle"
  | "rowTitle"
  | "pageTitle"
  | "hero"
  | "kpi"
  | "note";

export type TextVariant = TextVariantNew;

export type TextTone =
  | "default"
  | "secondary"
  | "tertiary"
  | "quiet"
  | "danger"
  | "positive"
  | "attention"
  | "onAccent"
  | "onInverse"
  | "onPrimary"
  | "bone";

const caps = { textTransform: "uppercase" } as const;

const pageTitle: TextStyle = {
  fontFamily: fontFamily.display,
  fontSize: fontSize.pageTitle,
  lineHeight: 34,
  letterSpacing: fontSize.pageTitle * letterSpacingEm.display,
  ...caps,
};

const body: TextStyle = { fontFamily: fontFamily.body, fontSize: fontSize.body, lineHeight: 24 };

export const textVariants: Record<TextVariant, TextStyle> = {
  eyebrow: {
    fontFamily: fontFamily.bodyBold,
    fontSize: fontSize.eyebrow,
    lineHeight: 16,
    letterSpacing: fontSize.eyebrow * letterSpacingEm.eyebrow,
    ...caps,
  },
  label: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.label, lineHeight: 18 },
  // Codes and IDs: Roboto Mono caps, wide tracking, never below 11.
  monoLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.monoLabel,
    lineHeight: 16,
    letterSpacing: fontSize.monoLabel * letterSpacingEm.label,
    ...caps,
  },
  caption: { fontFamily: fontFamily.body, fontSize: fontSize.caption, lineHeight: 18 },
  body,
  sectionTitle: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sectionTitle, lineHeight: 22 },
  rowTitle: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.body, lineHeight: 24 },
  pageTitle,
  hero: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.hero,
    lineHeight: 36,
    letterSpacing: fontSize.hero * letterSpacingEm.display,
    ...caps,
  },
  kpi: { fontFamily: fontFamily.bodyMedium, fontSize: fontSize.kpi, lineHeight: 32, fontVariant: ["tabular-nums"] },
  note: { fontFamily: fontFamily.condensed, fontSize: fontSize.note, lineHeight: 20 },

};

// Variants whose colour defaults to secondary text when tone is "default".
const SECONDARY_BY_DEFAULT: ReadonlySet<TextVariant> = new Set(["eyebrow", "label", "note"]);

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
  onPrimary: "onPrimary",
  bone: "bone",
};

export function textStyle(variant: TextVariant, tone: TextTone, c: SemanticColors): TextStyle {
  const key = tone === "default" && SECONDARY_BY_DEFAULT.has(variant) ? "textSecondary" : toneColor[tone];
  return { ...textVariants[variant], color: c[key] };
}

/** Variants read as headings by screen readers. */
export const HEADING_VARIANTS: ReadonlySet<TextVariant> = new Set(["pageTitle", "hero"]);

// Big display type can't grow without limit or it stops fitting; everything
// else follows the OS setting fully (rows grow, titles wrap).
export const maxFontScale: Record<TextVariant, number | undefined> = {
  eyebrow: undefined,
  label: undefined,
  monoLabel: 2,
  caption: undefined,
  body: undefined,
  sectionTitle: undefined,
  rowTitle: undefined,
  pageTitle: 1.4,
  hero: 1.3,
  kpi: 1.6,
  note: undefined,
};

// ── Button ──────────────────────────────────────────────────────────────────

/**
 * primary / secondary / text / danger / dangerFill (design-spec §4).
 * Plus `ghost` (plain, no underline: sheet Close buttons, Cancel in a bar).
 */
export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "dangerFill" | "ghost";
export type ButtonSize = "default" | "small";

export function buttonStyle(
  variant: ButtonVariant,
  c: SemanticColors,
  state: { pressed: boolean; disabled: boolean },
  size: ButtonSize = "default",
): { container: ViewStyle; text: TextStyle; textColor: string } {
  const small = size === "small";
  const base: ViewStyle = {
    minHeight: small ? touch.floor : 50,
    minWidth: touch.minTarget,
    paddingHorizontal: 16,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  };
  const label: TextStyle = {
    fontFamily: variant === "text" || variant === "ghost" ? fontFamily.bodySemibold : fontFamily.bodyBold,
    fontSize: small || variant === "text" || variant === "ghost" ? 15 : 16,
    lineHeight: 22,
    textAlign: "center",
  };
  const out = (container: ViewStyle, textColor: string, extra: TextStyle = {}) => ({
    container: { ...base, ...container },
    text: { ...label, ...extra, color: textColor },
    textColor,
  });

  // Disabled: a quiet filled block, readable (textTertiary on surface is
  // 5.4:1), so it never looks like an outline the person can tap.
  if (state.disabled && variant !== "text" && variant !== "ghost") {
    return out({ backgroundColor: c.surface, borderColor: c.rule }, c.textTertiary);
  }
  switch (variant) {
    case "primary":
      return out({ backgroundColor: state.pressed ? c.primaryPressed : c.primary, borderColor: "transparent" }, c.onPrimary);
    case "secondary":
      return out({ backgroundColor: state.pressed ? c.surface : c.raised, borderColor: c.ruleStrong }, c.text);
    case "text":
      return out(
        { minHeight: touch.floor, paddingHorizontal: 8, backgroundColor: state.pressed ? c.surface : "transparent" },
        state.disabled ? c.textTertiary : c.text,
        { textDecorationLine: "underline" },
      );
    case "ghost":
      return out(
        { minHeight: touch.floor, paddingHorizontal: 8, backgroundColor: state.pressed ? c.surface : "transparent" },
        state.disabled ? c.textTertiary : c.text,
      );
    case "danger":
      return out({ backgroundColor: state.pressed ? c.surface : "transparent", borderColor: c.danger }, c.danger);
    case "dangerFill":
      return out({ backgroundColor: c.danger, borderColor: c.danger, opacity: state.pressed ? 0.85 : 1 }, c.onDanger);
  }
}

// ── Banner ──────────────────────────────────────────────────────────────────

/**
 * info / offline / error / queued (full 1px border + leading icon).
 * Also `danger` (= error) and `positive`. The yellow band is NeedsYouBand.
 */
export type BannerTone = "info" | "offline" | "error" | "queued" | "positive" | "danger";

export function bannerStyle(
  tone: BannerTone,
  c: SemanticColors,
): { container: ViewStyle; text: TextTone; iconColor: string } {
  const base: ViewStyle = {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: c.rule,
    backgroundColor: c.surface,
  };
  switch (tone) {
    case "error":
    case "danger":
      return { container: { ...base, borderColor: c.danger }, text: "default", iconColor: c.danger };
    case "positive":
      return { container: base, text: "default", iconColor: c.positiveText };
    case "info":
    case "offline":
    case "queued":
      return { container: base, text: "default", iconColor: c.text };
  }
}

/** The yellow band: fill only, 8pt radius, no border, black text. */
export function needsYouBandStyle(c: SemanticColors): ViewStyle {
  return {
    backgroundColor: c.accent,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
  };
}

// ── Status chip ─────────────────────────────────────────────────────────────

export type ChipVariant = "positive" | "attention" | "danger" | "ink" | "quiet" | "dashed" | "neutral";

export function chipStyle(variant: ChipVariant, c: SemanticColors): { container: ViewStyle; color: string } {
  const base: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: c.rule,
    backgroundColor: c.raised,
  };
  switch (variant) {
    case "positive":
      return { container: { ...base, borderColor: c.positiveText }, color: c.positiveText };
    case "attention":
      return { container: { ...base, borderColor: c.attention }, color: c.attention };
    case "danger":
      return { container: { ...base, borderColor: c.danger }, color: c.danger };
    case "ink":
      return { container: { ...base, backgroundColor: c.inverse, borderColor: c.inverse }, color: c.onInverse };
    case "quiet":
      return { container: { ...base, backgroundColor: c.surface }, color: c.textSecondary };
    case "dashed":
      return { container: { ...base, borderStyle: "dashed", borderColor: c.ruleStrong }, color: c.text };
    case "neutral":
      return { container: base, color: c.textSecondary };
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
 * Switch colours (spec §4 Toggle): on = ink in light, yellow in dark; off =
 * the strong rule (3:1 outline). Light keeps the white thumb; in dark the
 * thumb is light grey when off and black on the yellow track when on.
 * State is also in the row's words/role.
 */
export function switchColors(c: SemanticColors, scheme: ColorScheme, value: boolean) {
  return {
    trackColor: { false: c.ruleStrong, true: c.primary },
    ios_backgroundColor: c.ruleStrong,
    thumbColor: scheme === "dark" ? (value ? c.onPrimary : c.textSecondary) : c.bg,
  };
}
