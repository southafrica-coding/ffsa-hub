// Finance pieces for the redesign (frames 3.1–3.10) that the shared kit
// doesn't have yet. They are built from kit components and tokens only, and
// are listed in the PR under "Kit follow-ups" so they can be promoted later.
// (components/ui.tsx is the older set other features still import.)

import { ChevronRight, TriangleAlert, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { Banner, NavBar, Text, type BackAction } from "@/components";
import type { TextTone } from "@/theme/styles";
import { fontFamily, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { barFill, formatMoney, moneyLabel, type BudgetFigures } from "../money";
import { strings } from "../strings";

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * Lists, bands and banners sit 16pt from the edge while text sits on the
 * 20pt gutter (mockups). Screens pad by the gutter, so cards bleed out by 4.
 */
export function Bleed({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ marginHorizontal: space.inset - space.gutter }, style]}>{children}</View>;
}

/** A pushed page before its title is known (loading, error): back bar + padded body. */
export function PushedPage({ back, children, edges = ["top"] }: { back: BackAction; children: ReactNode; edges?: Edge[] }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.gutter }}>
        <NavBar back={back} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.xl, gap: space.lg }}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Section title with a count on the right ("Outreach teams · 3 teams") ───

export function SectionTitle({ title, meta, tight = false }: { title: string; meta?: string; tight?: boolean }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      style={{
        minHeight: touch.floor,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        paddingTop: tight ? space.md : space.xl,
        paddingBottom: space.sm,
      }}
    >
      <Text variant="sectionTitle" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {meta ? (
        <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

// ── A free-form row inside a kit ListGroup ──────────────────────────────────

/**
 * The kit's ListRow is title + caption + centred meta; a team or budget-line
 * row needs a full-width body (title row, bar, status lines). Same metrics as
 * ListRow: 56pt minimum, 16/12 side padding, chevron when it opens something.
 */
export function GroupRow({
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
  const box: ViewStyle = {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingLeft: space.lg,
    paddingRight: space.md,
  };
  const body = <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>{children}</View>;
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} testID={testID} style={box}>
        {body}
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
      style={({ pressed }) => ({ ...box, backgroundColor: pressed ? colors.surfaceStrong : "transparent" })}
    >
      {body}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronRight size={18} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

/**
 * A row that only tells (a roster line, the finance-office placeholder). The
 * kit's ListRow is a Pressable even without onPress, so a static row is still
 * announced as something to tap; this one is a plain View.
 */
export function InfoRow({ icon: Icon, title, subtitle, meta, accessibilityLabel }: { icon?: LucideIcon; title: string; subtitle?: string; meta?: string; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(". ")}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 10, paddingLeft: space.lg, paddingRight: space.md }}
    >
      {Icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.card,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.surface,
            borderWidth: hairline,
            borderColor: colors.rule,
          }}
        >
          <Icon size={20} color={colors.text} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="rowTitle">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text variant="label" style={{ flexShrink: 0, maxWidth: "45%", textAlign: "right" }}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

// ── A status in words with its icon (receipts, unsent counts) ──────────────

export function StatusLine({ icon: Icon, tone, children }: { icon: LucideIcon; tone: "positive" | "attention" | "danger" | "secondary"; children: string }) {
  const { colors } = useTheme();
  const color = { positive: colors.positiveText, attention: colors.attention, danger: colors.danger, secondary: colors.textSecondary }[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={14} color={color} />
      </View>
      <Text variant="caption" tone={tone as TextTone} style={{ fontFamily: fontFamily.bodyMedium, flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  );
}

// ── Budget bar: figures and words always shown, never colour alone ─────────

export function BudgetBar({ figures, currency, compact = false }: { figures: BudgetFigures; currency: string; compact?: boolean }) {
  const { colors } = useTheme();
  const fill = barFill(figures.ratio);
  const whole = { cents: false };
  const summary =
    figures.ratio === null
      ? strings.team.noBudget
      : figures.over
        ? `${strings.team.over} by ${formatMoney(-figures.remaining, currency, whole)}`
        : `${figures.pctSpent}% spent`;
  const spokenSummary =
    figures.ratio === null
      ? strings.team.noBudget
      : figures.over
        ? `${strings.team.over} by ${moneyLabel(-figures.remaining, currency, whole)}`
        : `${figures.pctSpent} percent spent`;
  const label = `${strings.team.budget} ${moneyLabel(figures.total, currency, whole)}, ${strings.team.spent} ${moneyLabel(figures.spent, currency, whole)}, ${strings.team.remaining} ${moneyLabel(figures.remaining, currency, whole)}. ${spokenSummary}.`;
  const words = compact ? `${formatMoney(figures.spent, currency, whole)} of ${formatMoney(figures.total, currency, whole)} · ${summary}` : summary;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={figures.pctSpent === null ? undefined : { min: 0, max: 100, now: Math.min(100, Math.floor(figures.pctSpent)) }}
      style={{ gap: compact ? space.xs : space.sm }}
    >
      {!compact ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: space.xs }}>
          <Figure label={strings.team.budget} value={formatMoney(figures.total, currency, whole)} />
          <Figure label={strings.team.spent} value={formatMoney(figures.spent, currency, whole)} />
          <Figure label={strings.team.remaining} value={formatMoney(figures.remaining, currency, whole)} danger={figures.over} />
        </View>
      ) : null}
      {figures.ratio !== null ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.rule, overflow: "hidden" }}>
          <View testID="budget-bar-fill" style={{ height: 6, width: `${fill * 100}%`, backgroundColor: figures.over ? colors.danger : colors.text }} />
        </View>
      ) : null}
      {figures.over ? (
        <StatusLine icon={TriangleAlert} tone="danger">
          {words}
        </StatusLine>
      ) : (
        <Text variant="caption" tone="secondary">
          {words}
        </Text>
      )}
    </View>
  );
}

function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <View>
      <Text variant="label">{label}</Text>
      <Text variant="sectionTitle" tone={danger ? "danger" : "default"} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}

// ── Errors and stale copies: say what to do, offer Try again ───────────────

export function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Banner tone="error" title={title} actionLabel={strings.common.tryAgain} onAction={onRetry}>
      {message}
    </Banner>
  );
}

export function StaleNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Banner tone="offline" actionLabel={strings.common.tryAgain} onAction={onRetry}>
      {message}
    </Banner>
  );
}
