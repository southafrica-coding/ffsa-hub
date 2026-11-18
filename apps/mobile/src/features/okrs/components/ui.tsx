// Small pieces the OKR screens share. The general ones (section bar, tag,
// row, sheet, chips, skeleton, error, stale note) are finance's, as Bookings
// and My Schools reuse them; only what's specific to OKRs lives here.

import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { Sheet } from "@/features/finance/components/Sheet";
import { StaleNote, Tag } from "@/features/finance/components/ui";
import type { LoadState } from "@/features/finance/use-cached-load";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { formatDay, statusLabel, statusTone } from "../logic";
import { strings } from "../strings";
import type { OkrCycle, OkrStatus } from "../types";

/** A status word in a bordered tag: the word carries the meaning, colour only helps. */
export function StatusTag({ status, text, testID }: { status: OkrStatus; text?: string; testID?: string }) {
  return (
    <View testID={testID}>
      <Tag tone={statusTone(status)}>{text ?? statusLabel(status)}</Tag>
    </View>
  );
}

/** One figure in a KPI strip: mono label, condensed numeral, a foot in words. */
export function Kpi({
  label,
  value,
  foot,
  tone = "default",
  barPct,
  testID,
}: {
  label: string;
  value: number;
  foot?: string;
  tone?: "default" | "danger";
  /** Only where a real ratio exists ("no ratio, no bar"). */
  barPct?: number;
  testID?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={[label, String(value), foot].filter(Boolean).join(", ")}
      testID={testID}
      style={{ gap: 4, flexGrow: 1, flexBasis: 140, paddingVertical: 8 }}
    >
      <Text variant="monoLabel" tone="secondary">
        {label}
      </Text>
      <Text variant="numeral" tone={tone} style={{ fontVariant: ["tabular-nums"] }}>
        {String(value)}
      </Text>
      {barPct !== undefined ? <Bar pct={barPct} /> : null}
      {foot ? (
        <Text variant="caption" tone={tone === "danger" ? "danger" : "secondary"}>
          {foot}
        </Text>
      ) : null}
    </View>
  );
}

export function KpiStrip({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: 16,
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        paddingBottom: 4,
      }}
    >
      {children}
    </View>
  );
}

/** A plain progress track. Decorative: the caption beside it says the figure in words. */
export function Bar({ pct, testID }: { pct: number; testID?: string }) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 6, backgroundColor: colors.surfaceStrong }}
    >
      <View testID={testID} style={{ height: 6, width: `${clamped}%`, backgroundColor: colors.text }} />
    </View>
  );
}

/**
 * The cycle picker: shows which cycle is on screen, and (when there's more
 * than one) opens a bottom sheet to choose another. A radio list, so screen
 * readers hear which one is selected.
 */
export function CycleSwitcher({
  cycles,
  active,
  onChange,
}: {
  cycles: OkrCycle[];
  active: OkrCycle;
  onChange: (slug: string) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const name = active.isCurrent ? strings.cycle.current(active.name) : active.name;
  const dates = strings.cycle.dates(formatDay(active.startsOn), formatDay(active.endsOn));

  if (cycles.length <= 1) {
    return (
      <View accessible accessibilityLabel={`${strings.cycle.label}: ${name}. ${dates}`} style={{ gap: 2 }}>
        <Text variant="monoLabel" tone="secondary">
          {strings.cycle.label}
        </Text>
        <Text variant="bodyStrong">{name}</Text>
        <Text variant="caption" tone="secondary">
          {dates}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        testID="cycle-switcher"
        accessibilityRole="button"
        accessibilityLabel={strings.cycle.switchA11y(name)}
        accessibilityHint={`${dates}. ${strings.cycle.switchHint}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: touch.minTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderWidth: hairline,
          borderColor: colors.text,
          backgroundColor: pressed ? colors.surface : "transparent",
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="monoLabel" tone="secondary">
            {strings.cycle.label}
          </Text>
          <Text variant="bodyStrong">{name}</Text>
          <Text variant="caption" tone="secondary">
            {dates}
          </Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronDown size={20} color={colors.text} />
        </View>
      </Pressable>
      <Sheet visible={open} title={strings.cycle.pickerTitle} onClose={() => setOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={strings.cycle.pickerTitle}>
          {cycles.map((c) => {
            const selected = c.slug === active.slug;
            const label = c.isCurrent ? strings.cycle.current(c.name) : c.name;
            return (
              <Pressable
                key={c.id}
                testID={`cycle-${c.slug}`}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityHint={strings.cycle.dates(formatDay(c.startsOn), formatDay(c.endsOn))}
                accessibilityState={{ selected, checked: selected }}
                onPress={() => {
                  setOpen(false);
                  if (!selected) onChange(c.slug);
                }}
                style={({ pressed }) => ({
                  minHeight: touch.minTarget + 8,
                  justifyContent: "center",
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderBottomWidth: hairline,
                  borderBottomColor: colors.rule,
                  borderLeftWidth: selected ? 3 : 0,
                  borderLeftColor: colors.text,
                  backgroundColor: selected || pressed ? colors.surface : "transparent",
                })}
              >
                <Text variant={selected ? "bodyStrong" : "body"}>{label}</Text>
                <Text variant="caption" tone="secondary">
                  {strings.cycle.dates(formatDay(c.startsOn), formatDay(c.endsOn))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated" line, or the stale note with a retry if a refresh failed.
 */
export function Freshness<T>({ state, onRetry }: { state: LoadState<T>; onRetry: () => void }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) return <StaleNote message={strings.common.refreshFailed(when)} onRetry={onRetry} />;
  return (
    <Text variant="caption" tone="secondary" testID="last-updated">
      {strings.common.lastUpdated(when)}
    </Text>
  );
}
