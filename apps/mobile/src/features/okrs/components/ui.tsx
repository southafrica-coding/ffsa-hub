// OKR pieces for the redesign (frames 10.1–10.8) that the shared kit doesn't
// have: the status chip mapping, the figure strip, the progress bar and the
// cycle switcher. Built from kit components and tokens only. The general
// ones (section title with a count, free-form list row, load error, stale
// note) are finance's parts, as its own screens use them.

import { ChevronDown, ChevronRight, Clock, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { Children, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";

import { ListGroup, Sheet, StatusChip, Text, type StatusChipProps } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { StaleNote } from "@/features/finance/components/parts";
import type { LoadState } from "@/features/finance/use-cached-load";
import { hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { formatDay, statusLabel } from "../logic";
import { strings } from "../strings";
import type { OkrCycle, OkrStatus } from "../types";

// ── Status chip ─────────────────────────────────────────────────────────────

// Same tones as logic.ts statusTone (complete / moving forward good, stuck
// bad, the rest quiet), each with its own icon so two greens still differ.
// "Not started" is the word alone, as the frames draw it.
const STATUS_CHIP: Record<OkrStatus, { variant: StatusChipProps["variant"]; icon?: LucideIcon | null }> = {
  complete: { variant: "positive" },
  moving_forward: { variant: "positive", icon: ChevronRight },
  in_progress: { variant: "neutral", icon: Clock },
  not_started: { variant: "neutral", icon: null },
  stuck: { variant: "danger", icon: TriangleAlert },
};

/** A status in words (and usually an icon): the word carries the meaning, colour only helps. */
export function StatusTag({ status, text, testID }: { status: OkrStatus; text?: string; testID?: string }) {
  const chip = STATUS_CHIP[status];
  return <StatusChip label={text ?? statusLabel(status)} variant={chip.variant} icon={chip.icon} testID={testID} />;
}

// ── Figures ─────────────────────────────────────────────────────────────────

/** One figure in the strip: a sentence-case label, the number, a foot in words. */
export function Figure({
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
    <View accessible accessibilityLabel={[label, String(value), foot].filter(Boolean).join(", ")} testID={testID} style={{ gap: 2 }}>
      <Text variant="label">{label}</Text>
      <Text variant="kpi" tone={tone}>
        {String(value)}
      </Text>
      {barPct !== undefined ? (
        <View style={{ marginTop: space.xs, marginBottom: 2 }}>
          <Bar pct={barPct} />
        </View>
      ) : null}
      {foot ? (
        <Text variant="caption" tone="secondary">
          {foot}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The figures between two ink rules. Two columns on the wall; `four` puts a
 * group's four short figures on one line, falling back to two columns once
 * the text is large enough that four labels would no longer fit.
 */
export function FigureStrip({ children, four = false }: { children: ReactNode; four?: boolean }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const columns = four && fontScale <= 1.15 ? 4 : 2;
  const gap = columns === 4 ? space.sm : space.lg;
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: gap,
        rowGap: space.md,
        paddingVertical: space.md,
        borderTopWidth: hairline,
        borderBottomWidth: hairline,
        borderColor: colors.text,
      }}
    >
      {Children.toArray(children).map((child, i) => (
        // Basis below an even share, then grow: the gaps never push a cell to the next line.
        <View key={i} style={{ flexGrow: 1, flexShrink: 1, flexBasis: columns === 4 ? "20%" : "40%", minWidth: 0 }}>
          {child}
        </View>
      ))}
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
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.rule, overflow: "hidden" }}
    >
      <View testID={testID} style={{ height: 6, borderRadius: 3, width: `${clamped}%`, backgroundColor: colors.text }} />
    </View>
  );
}

// ── Cycle switcher ──────────────────────────────────────────────────────────

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
  const words = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text variant="label">{strings.cycle.label}</Text>
      <Text variant="rowTitle">{name}</Text>
      <Text variant="caption" tone="secondary">
        {dates}
      </Text>
    </View>
  );

  // One cycle: nothing to choose, so it's plain text with no chevron.
  if (cycles.length <= 1) {
    return (
      <View accessible accessibilityLabel={`${strings.cycle.label}: ${name}. ${dates}`} style={{ flexDirection: "row" }}>
        {words}
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
          minHeight: touch.floor,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderWidth: hairline,
          borderColor: colors.ruleStrong,
          borderRadius: radius.control,
          backgroundColor: pressed ? colors.surfaceStrong : colors.raised,
        })}
      >
        {words}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronDown size={20} color={colors.text} />
        </View>
      </Pressable>
      <Sheet visible={open} title={strings.cycle.pickerTitle} onClose={() => setOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={strings.cycle.pickerTitle}>
          <ListGroup inset={false}>
            {cycles.map((c) => {
              const selected = c.slug === active.slug;
              const label = c.isCurrent ? strings.cycle.current(c.name) : c.name;
              const range = strings.cycle.dates(formatDay(c.startsOn), formatDay(c.endsOn));
              return (
                <Pressable
                  key={c.id}
                  testID={`cycle-${c.slug}`}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityHint={range}
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => {
                    setOpen(false);
                    if (!selected) onChange(c.slug);
                  }}
                  style={({ pressed }) => ({
                    minHeight: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingVertical: 10,
                    paddingLeft: space.lg,
                    paddingRight: space.md,
                    backgroundColor: pressed ? colors.surfaceStrong : "transparent",
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="rowTitle">{label}</Text>
                    <Text variant="caption" tone="secondary">
                      {range}
                    </Text>
                  </View>
                  <RadioMark selected={selected} />
                </Pressable>
              );
            })}
          </ListGroup>
        </View>
      </Sheet>
    </>
  );
}

/** The radio circle: a ring, filled with an ink dot when chosen (the row says so in words too). */
function RadioMark({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: selected ? 2 : hairline,
        borderColor: selected ? colors.text : colors.ruleStrong,
      }}
    >
      {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.text }} /> : null}
    </View>
  );
}

// ── Saved copy ──────────────────────────────────────────────────────────────

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated" line, or the offline note with a retry if a refresh failed
 * (frame 13.3). `checkinsNote` adds that check-ins need a signal.
 */
export function Freshness<T>({ state, onRetry, checkinsNote = false }: { state: LoadState<T>; onRetry: () => void; checkinsNote?: boolean }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) {
    return (
      <View style={{ gap: space.sm }}>
        <StaleNote message={strings.common.refreshFailed(when)} onRetry={onRetry} />
        {checkinsNote ? (
          <Text variant="note" testID="checkins-need-signal" style={{ paddingHorizontal: space.xs }}>
            {strings.common.checkinsNeedSignal}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <Text variant="caption" tone="secondary" testID="last-updated">
      {strings.common.lastUpdated(when)}
    </Text>
  );
}
