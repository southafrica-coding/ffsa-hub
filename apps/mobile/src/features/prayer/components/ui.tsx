// Small building blocks for the Prayer Room screens. They live with the slice
// (not the shared kit) so parallel branches don't edit src/components. The
// Sheet now lives in the kit and is re-exported below.

import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect } from "react";
import { Platform, Pressable, View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { announce, useReduceMotion } from "@/lib/a11y";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

// Shared with the rest of the app (src/lib/a11y); re-exported for old imports.
export { useReduceMotion };

// ── Bottom sheet ────────────────────────────────────────────────────────────

// Moved to the kit (src/components/Sheet.tsx); re-exported for old imports.
export { Sheet } from "@/components";

// ── Segmented control (the web's module tab strip) ──────────────────────────

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

// ── Chips: status in words (never colour alone) ─────────────────────────────

export type ChipTone = "outline" | "ink" | "band";

/** A mono caps tag. "band" is the drawer's black chip with yellow letters. */
export function Chip({ label, tone = "outline", testID }: { label: string; tone?: ChipTone; testID?: string }) {
  const { colors, scheme } = useTheme();
  const box =
    tone === "outline"
      ? { backgroundColor: "transparent", borderColor: colors.ruleStrong }
      : { backgroundColor: colors.inverse, borderColor: colors.inverse };
  return (
    <View testID={testID} style={{ paddingHorizontal: 6, paddingVertical: 2, borderWidth: hairline, ...box }}>
      <Text
        variant="monoLabel"
        tone={tone === "outline" ? "secondary" : "onInverse"}
        // Yellow on ink is ~11:1; on the dark scheme the chip inverts to bone.
        style={tone === "band" ? { color: scheme === "dark" ? colors.onInverse : colors.accent } : undefined}
      >
        {label}
      </Text>
    </View>
  );
}

// ── Week stepper ────────────────────────────────────────────────────────────

export function WeekNav({
  label,
  onPrev,
  onNext,
  onToday,
  isThisWeek,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isThisWeek: boolean;
}) {
  const { colors } = useTheme();
  const arrow = (dir: "prev" | "next") => (
    <Pressable
      testID={`week-${dir}`}
      accessibilityRole="button"
      accessibilityLabel={dir === "prev" ? strings.week.previous : strings.week.next}
      onPress={dir === "prev" ? onPrev : onNext}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth: touch.minTarget,
        minHeight: touch.minTarget,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: hairline,
        borderColor: colors.text,
        backgroundColor: pressed ? colors.surfaceStrong : "transparent",
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {dir === "prev" ? <ChevronLeft size={22} color={colors.text} /> : <ChevronRight size={22} color={colors.text} />}
      </View>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {arrow("prev")}
      <View style={{ flex: 1, minWidth: 120 }} accessible accessibilityLabel={strings.week.weekOf(label)}>
        <Text variant="monoLabel" style={{ textAlign: "center" }}>
          {label}
        </Text>
      </View>
      {arrow("next")}
      {!isThisWeek ? (
        <Button
          label={strings.week.today}
          variant="ghost"
          onPress={onToday}
          accessibilityHint={strings.week.todayHint}
          testID="week-today"
        />
      ) : null}
    </View>
  );
}

// ── Error with a retry ──────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  // Danger banners announce themselves on iOS (src/components/Banner.tsx).
  return (
    <Banner
      tone="danger"
      title={strings.errors.title}
      testID="error-state"
      action={<Button label={strings.errors.retry} variant="secondary" onPress={onRetry} />}
    >
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
  // Danger banners announce themselves on iOS; the positive result is spoken here.
  useAnnounceOnIOS(result?.ok ? result.message : null);
  if (!result) return null;
  return (
    <Banner tone={result.ok ? "positive" : "danger"} testID={result.ok ? "action-ok" : "action-error"}>
      {result.message}
    </Banner>
  );
}

/** Mono caps label line with an optional right-hand note. */
export function LabelRow({ label, right }: { label: string; right?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <Text variant="monoLabel" tone="secondary" accessibilityRole="header">
        {label}
      </Text>
      {right ? (
        <Text variant="monoLabel" tone="attention">
          {right}
        </Text>
      ) : null}
    </View>
  );
}
