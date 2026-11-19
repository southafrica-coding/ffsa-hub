// Small building blocks for the Prayer Room screens that the shared kit
// doesn't carry (yet): the week stepper, the curated-band chip, a day header
// that reads its date in full, and the result of the last action.

import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect } from "react";
import { Platform, Pressable, View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { announce } from "@/lib/a11y";
import { fontFamily, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { dayLabel, spokenDate } from "../logic";
import { strings } from "../strings";

// ── Old segmented control ───────────────────────────────────────────────────

/**
 * The pre-redesign tab strip. The Prayer tab now uses the kit's
 * SegmentedControl; this stays only because the Training tab still imports
 * it (restyled with the kit in its own slice).
 */
export function Segments<K extends string>({
  items,
  active,
  onChange,
}: {
  items: { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", borderWidth: hairline, borderColor: colors.text }}>
      {items.map((item, i) => {
        const on = item.key === active;
        return (
          <Pressable
            key={item.key}
            testID={`segment-${item.key}`}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityHint={strings.segments.a11yHint(i + 1, items.length)}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: touch.minTarget,
              paddingHorizontal: 4,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: on ? colors.inverse : pressed ? colors.surface : "transparent",
              borderLeftWidth: i === 0 ? 0 : hairline,
              borderLeftColor: colors.text,
            })}
          >
            <Text variant="monoLabel" tone={on ? "onInverse" : "default"} style={{ textAlign: "center" }}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Curated band chip ───────────────────────────────────────────────────────

/**
 * MORNING / NOON / NIGHT: the curated band a set sits in. A heavier outline
 * and tracked capitals, as the band is named on the wall; the word carries it.
 */
export function BandChip({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        minHeight: 24,
        paddingHorizontal: space.sm,
        borderRadius: radius.control,
        borderWidth: 1.5,
        borderColor: colors.text,
        alignSelf: "flex-start",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, fontSize: 11, lineHeight: 16, letterSpacing: 0.9, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
}

// ── Week stepper ────────────────────────────────────────────────────────────

export type WeekNavProps = {
  /** "16–20 Nov · This week" or "23–27 Nov 2026". */
  label: string;
  /** What a screen reader says for the label. */
  spokenLabel: string;
  /** "9 sets · 6 seats open" (the week view only). */
  summary?: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isThisWeek: boolean;
};

export function WeekNav({ label, spokenLabel, summary, onPrev, onNext, onToday, isThisWeek }: WeekNavProps) {
  const { colors } = useTheme();
  const arrow = (dir: "prev" | "next") => (
    <Pressable
      testID={`week-${dir}`}
      accessibilityRole="button"
      accessibilityLabel={dir === "prev" ? strings.week.previous : strings.week.next}
      onPress={dir === "prev" ? onPrev : onNext}
      hitSlop={4}
      style={({ pressed }) => ({
        width: touch.floor,
        minHeight: touch.floor,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.control,
        backgroundColor: pressed ? colors.surfaceStrong : "transparent",
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {dir === "prev" ? <ChevronLeft size={22} color={colors.text} /> : <ChevronRight size={22} color={colors.text} />}
      </View>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, marginHorizontal: -space.sm }}>
      {arrow("prev")}
      <View
        accessible
        accessibilityLabel={summary ? `${spokenLabel}. ${summary}` : spokenLabel}
        style={{ flex: 1, minWidth: 0, alignItems: "center" }}
      >
        <Text variant="sectionTitle" style={{ textAlign: "center" }}>
          {label}
        </Text>
        {summary ? (
          <Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
            {summary}
          </Text>
        ) : null}
      </View>
      {!isThisWeek ? (
        <Button
          label={strings.week.today}
          variant="secondary"
          size="small"
          onPress={onToday}
          accessibilityHint={strings.week.todayHint}
          testID="week-today"
          style={{ paddingHorizontal: 10 }}
        />
      ) : null}
      {arrow("next")}
    </View>
  );
}

// ── Day header ──────────────────────────────────────────────────────────────

/** "Wed 18 Nov" as a section title; read aloud as "Wednesday 18 November". */
export function DayHeader({ date }: { date: string }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={spokenDate(date)}
      style={{ paddingTop: space.xs, paddingBottom: space.sm }}
    >
      <Text variant="sectionTitle">{dayLabel(date)}</Text>
    </View>
  );
}

// ── Error with a retry ──────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  // Error banners announce themselves on iOS (src/components/Banner.tsx).
  return (
    <Banner tone="error" title={strings.errors.title} testID="error-state" actionLabel={strings.errors.retry} onAction={onRetry}>
      {message}
    </Banner>
  );
}

/**
 * VoiceOver ignores Android's live regions, so a positive result speaks its
 * message on iOS as it appears (Android's Banner live region already does).
 */
function useAnnounceOnIOS(message: string | null | undefined) {
  useEffect(() => {
    if (Platform.OS === "ios") announce(message);
  }, [message]);
}

/** The result of the last action, announced to screen readers as it appears. */
export function ActionNotice({ result }: { result: { ok: boolean; message: string } | null }) {
  // Error banners announce themselves on iOS; the positive result is spoken here.
  useAnnounceOnIOS(result?.ok ? result.message : null);
  if (!result) return null;
  return (
    <Banner tone={result.ok ? "positive" : "error"} testID={result.ok ? "action-ok" : "action-error"}>
      {result.message}
    </Banner>
  );
}

/** Sentence-case label line with an optional right-hand note. */
export function LabelRow({ label, right }: { label: string; right?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.sm, flexWrap: "wrap" }}>
      <Text variant="label" accessibilityRole="header">
        {label}
      </Text>
      {right ? (
        <Text variant="caption" tone="secondary">
          {right}
        </Text>
      ) : null}
    </View>
  );
}
