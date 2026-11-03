// Small building blocks the finance screens share. They live with the
// feature (not the shared kit) so other slices aren't touched; candidates
// to move into src/components once a second feature needs them.

import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Pressable, View, type ViewStyle } from "react-native";

import { Banner, Button, Text } from "@/components";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { barFill, formatMoney, moneyLabel, type BudgetFigures } from "../money";
import { strings } from "../strings";

// ── Section bar (the web's black bar with a mono caps label) ────────────────

export function SectionBar({ title, meta }: { title: string; meta?: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="header"
      accessible
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      style={{
        backgroundColor: colors.inverse,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Text variant="label" tone="onInverse">
        {title}
      </Text>
      {meta ? (
        <Text variant="label" tone="onInverse">
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

// ── Budget bar: numbers always shown, never colour alone ────────────────────

export function BudgetBar({ figures, currency, compact = false }: { figures: BudgetFigures; currency: string; compact?: boolean }) {
  const { colors } = useTheme();
  const fill = barFill(figures.ratio);
  const summary =
    figures.ratio === null
      ? strings.team.noBudget
      : figures.over
        ? `${strings.team.over} by ${formatMoney(-figures.remaining, currency, { cents: false })}`
        : `${figures.pctSpent}% spent`;
  const spokenSummary =
    figures.ratio === null
      ? strings.team.noBudget
      : figures.over
        ? `${strings.team.over} by ${moneyLabel(-figures.remaining, currency, { cents: false })}`
        : `${figures.pctSpent} percent spent`;
  const label = `${strings.team.budget} ${moneyLabel(figures.total, currency, { cents: false })}, ${strings.team.spent} ${moneyLabel(figures.spent, currency, { cents: false })}, ${strings.team.remaining} ${moneyLabel(figures.remaining, currency, { cents: false })}. ${spokenSummary}.`;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={figures.pctSpent === null ? undefined : { min: 0, max: 100, now: Math.min(100, Math.floor(figures.pctSpent)) }}
      style={{ gap: 6 }}
    >
      {!compact ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
          <Figure label={strings.team.budget} value={formatMoney(figures.total, currency, { cents: false })} />
          <Figure label={strings.team.spent} value={formatMoney(figures.spent, currency, { cents: false })} />
          <Figure
            label={strings.team.remaining}
            value={formatMoney(figures.remaining, currency, { cents: false })}
            tone={figures.over ? "danger" : "default"}
          />
        </View>
      ) : null}
      {figures.ratio !== null ? (
        <View style={{ height: 6, backgroundColor: colors.surfaceStrong }}>
          <View
            testID="budget-bar-fill"
            style={{ height: 6, width: `${fill * 100}%`, backgroundColor: figures.over ? colors.danger : colors.text }}
          />
        </View>
      ) : null}
      <Text variant="caption" tone={figures.over ? "danger" : "secondary"}>
        {compact
          ? `${formatMoney(figures.spent, currency, { cents: false })} of ${formatMoney(figures.total, currency, { cents: false })} · ${summary}`
          : summary}
      </Text>
    </View>
  );
}

function Figure({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong" tone={tone} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}

// ── Tags: a bordered word, so status never rests on colour ──────────────────

export function Tag({ children, tone = "default" }: { children: string; tone?: "default" | "attention" | "positive" | "danger" }) {
  const { colors } = useTheme();
  const border = { default: colors.ruleStrong, attention: colors.attentionBorder, positive: colors.positive, danger: colors.danger }[tone];
  return (
    <View style={{ borderWidth: hairline, borderColor: border, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text variant="label" tone={tone === "default" ? "secondary" : tone}>
        {children}
      </Text>
    </View>
  );
}

// ── A full-width tappable row, 48dp minimum ─────────────────────────────────

export function Row({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const style = (pressed: boolean): ViewStyle => ({
    minHeight: touch.minTarget,
    paddingVertical: 12,
    borderBottomWidth: hairline,
    borderBottomColor: colors.rule,
    backgroundColor: pressed ? colors.surface : "transparent",
    gap: 6,
  });
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} style={style(false)} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => style(pressed)}
    >
      {children}
    </Pressable>
  );
}

// ── Choice chips (a radio group) ────────────────────────────────────────────

export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => ({
                minHeight: touch.minTarget,
                paddingHorizontal: 14,
                justifyContent: "center",
                borderWidth: selected ? 2 : hairline,
                borderColor: selected ? colors.text : colors.ruleStrong,
                backgroundColor: selected ? colors.surface : pressed ? colors.surface : "transparent",
                opacity: disabled ? 0.45 : 1,
              })}
            >
              <Text variant={selected ? "bodyStrong" : "body"}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Loading skeleton (still when the person has asked for less motion) ─────

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function Skeleton({ rows = 4, label }: { rows?: number; label: string }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} testID="skeleton" style={{ gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={{ opacity: pulse, gap: 6 }}>
          <View style={{ height: 18, width: "60%", backgroundColor: colors.surfaceStrong }} />
          <View style={{ height: 12, width: "85%", backgroundColor: colors.surface }} />
        </Animated.View>
      ))}
    </View>
  );
}

// ── Error / empty / stale ───────────────────────────────────────────────────

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Banner tone="danger" title={title} action={<Button label={strings.common.tryAgain} variant="secondary" onPress={onRetry} />}>
      {message}
    </Banner>
  );
}

export function EmptyState({ title, body, extra }: { title: string; body: string; extra?: string | null }) {
  return (
    <View accessible style={{ paddingVertical: 32, gap: 8 }} testID="empty-state">
      <Text variant="title">{title}</Text>
      <Text tone="secondary">{body}</Text>
      {extra ? <Text tone="secondary">{extra}</Text> : null}
    </View>
  );
}

export function StaleNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Banner tone="info" action={<Button label={strings.common.tryAgain} variant="secondary" onPress={onRetry} />}>
      {message}
    </Banner>
  );
}
