// Small building blocks for the Prayer Room screens. They live with the slice
// (not the shared kit) so parallel branches don't edit src/components; the
// Sheet mirrors Finance's (worth promoting into the kit once a third needs it).

import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Button, Text } from "@/components";
import { announce, useReduceMotion } from "@/lib/a11y";
import { hairline, palette, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

// Shared with the rest of the app (src/lib/a11y); re-exported for old imports.
export { useReduceMotion };

// ── Bottom sheet ────────────────────────────────────────────────────────────

/**
 * Slides up from the bottom (no slide when reduce-motion is on), closes on
 * the scrim, the Close button or the system back gesture, and keeps
 * screen-reader focus inside while open.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          // The scrim is ink in both colour schemes. Hidden from screen
          // readers: the Close button and the back gesture do the same job.
          accessibilityRole="button"
          accessibilityLabel={strings.set.close}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.ink, opacity: 0.45 }}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={{
            maxHeight: "88%",
            backgroundColor: colors.bg,
            borderTopWidth: 2,
            borderTopColor: colors.text,
            paddingBottom: insets.bottom + 8,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingLeft: 20,
              paddingRight: 8,
              paddingVertical: 4,
              borderBottomWidth: hairline,
              borderBottomColor: colors.rule,
            }}
          >
            <Text variant="label" tone="secondary" style={{ flexShrink: 1 }} accessibilityRole="header">
              {title}
            </Text>
            <Button label={strings.set.close} variant="ghost" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16 }}>{children}</ScrollView>
          {footer ? (
            <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8, borderTopWidth: hairline, borderTopColor: colors.rule }}>
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

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
            <Text variant="label" tone={on ? "onInverse" : "default"} style={{ textAlign: "center" }}>
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
        variant="label"
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
        <Text variant="label" style={{ textAlign: "center" }}>
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
      <Text variant="label" tone="secondary" accessibilityRole="header">
        {label}
      </Text>
      {right ? (
        <Text variant="label" tone="attention">
          {right}
        </Text>
      ) : null}
    </View>
  );
}
