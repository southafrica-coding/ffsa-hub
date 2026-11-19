// Pieces My Schools and My History share (frames 8.1–8.6, 9.1–9.4) that
// stay feature-specific: the status chip mapping, the date block and the
// figure strip. The general ones (bleed, group row, section title, load
// states) now live in src/components.

import { View } from "react-native";

import { StatusChip, Text } from "@/components";
import type { ChipVariant } from "@/theme/styles";
import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { Tone } from "../logic";

// ── Status ──────────────────────────────────────────────────────────────────

const CHIP: Record<Tone, ChipVariant> = { positive: "positive", attention: "attention", danger: "danger", default: "neutral" };

/** A status word in a chip: the word carries the meaning, the icon and colour only help. */
export function StatusTag({ label, tone, testID }: { label: string; tone: Tone; testID?: string }) {
  return <StatusChip label={label} variant={CHIP[tone]} testID={testID} />;
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** Day over month in a small tile, leading an attendance row. The row's label says the date. */
export function DateBlock({ day, mon }: { day: string; mon: string }) {
  const { colors } = useTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        minWidth: 44,
        paddingVertical: space.xs,
        paddingHorizontal: space.xs,
        alignItems: "center",
        borderWidth: hairline,
        borderColor: colors.rule,
        borderRadius: radius.control,
        backgroundColor: colors.surface,
      }}
    >
      <Text variant="rowTitle" maxFontSizeMultiplier={1.4} style={{ fontVariant: ["tabular-nums"], lineHeight: 22 }}>
        {day}
      </Text>
      <Text variant="eyebrow" maxFontSizeMultiplier={1.4} style={{ fontSize: 11, lineHeight: 14 }}>
        {mon}
      </Text>
    </View>
  );
}

// ── Figures ─────────────────────────────────────────────────────────────────

/** One figure in a strip: a sentence-case label over a tabular number. `big` is the screen's one big number. */
export function Figure({ label, value, foot, big = false }: { label: string; value: string; foot?: string; big?: boolean }) {
  return (
    <View accessible accessibilityLabel={[label, value, foot].filter(Boolean).join(", ")} style={{ gap: 2, flexGrow: 1, flexBasis: big ? "100%" : 120 }}>
      <Text variant="label">{label}</Text>
      <Text variant="kpi" style={big ? BIG_KPI : undefined}>
        {value}
      </Text>
      {foot ? (
        <Text variant="caption" tone="secondary">
          {foot}
        </Text>
      ) : null}
    </View>
  );
}

/** The one big number on a screen (GPA, attendance %): the kpi variant at 32/40. */
export const BIG_KPI = { fontSize: 32, lineHeight: 40 } as const;
