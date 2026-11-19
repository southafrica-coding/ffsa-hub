// Small pieces the My Schools and My History screens share (frames 8.1–8.6,
// 9.1–9.4) that the kit doesn't have yet. Built from kit components and
// tokens only; listed in the PR under "Kit follow-ups".

import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";

import { Banner, StatusChip, Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import type { LoadState } from "@/features/finance/use-cached-load";
import type { ChipVariant } from "@/theme/styles";
import { hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { Tone } from "../logic";
import { strings } from "../strings";

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * Lists, the band and banners sit 16pt from the edge while text sits on the
 * 20pt gutter (mockups). The page pads by the gutter, so cards bleed out by 4.
 */
export function Bleed({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ marginHorizontal: space.inset - space.gutter }, style]}>{children}</View>;
}

/** A section title with its count in a quiet chip ("My enrolments  2"); read as one heading. */
export function SectionCount({ title, meta, tight = false }: { title: string; meta: string; tight?: boolean }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}, ${meta}`}
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
      <StatusChip label={meta} variant="quiet" icon={null} />
    </View>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

const CHIP: Record<Tone, ChipVariant> = { positive: "positive", attention: "attention", danger: "danger", default: "neutral" };

/** A status word in a chip: the word carries the meaning, the icon and colour only help. */
export function StatusTag({ label, tone, testID }: { label: string; tone: Tone; testID?: string }) {
  return <StatusChip label={label} variant={CHIP[tone]} testID={testID} />;
}

// ── A free-form row inside a kit ListGroup ──────────────────────────────────

/**
 * The kit's ListRow is icon + title + caption; these rows need a leading
 * date block, or a body with a status chip and a trailing grade. Same metrics
 * as ListRow (56pt minimum, 16/12 side padding, chevron when it opens
 * something), and a plain View when it only tells.
 */
export function GroupRow({
  children,
  lead,
  trail,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  children: ReactNode;
  /** Before the body (icon tile, date block). */
  lead?: ReactNode;
  /** After the body (a grade, a date, a chip). */
  trail?: ReactNode;
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
    paddingVertical: 10,
    paddingLeft: space.lg,
    paddingRight: space.md,
  };
  const content = (
    <>
      {lead}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>{children}</View>
      {trail ? <View style={{ alignItems: "flex-end", gap: space.xs, flexShrink: 0, maxWidth: "45%" }}>{trail}</View> : null}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} testID={testID} style={box}>
        {content}
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
      {content}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronRight size={18} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

/** The 36pt icon tile that leads a row, as the kit's ListRow draws it. */
export function IconTile({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 36,
        height: 36,
        borderRadius: radius.card,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bg,
        borderWidth: hairline,
        borderColor: colors.rule,
      }}
    >
      {children}
    </View>
  );
}

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

// ── Load states ─────────────────────────────────────────────────────────────

/** Couldn't load: what happened, what to do, and Try again. */
export function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Banner tone="error" title={title} actionLabel={strings.common.tryAgain} onAction={onRetry}>
      {message}
    </Banner>
  );
}

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated" line, or a calm offline note with a retry if a refresh failed.
 */
export function Freshness<T>({ state, onRetry }: { state: LoadState<T>; onRetry: () => void }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) {
    return (
      <Bleed>
        <Banner tone="offline" actionLabel={strings.common.tryAgain} onAction={onRetry}>
          {strings.common.refreshFailed(when)}
        </Banner>
      </Bleed>
    );
  }
  return (
    <Text variant="caption" tone="secondary" testID="last-updated">
      {strings.common.lastUpdated(when)}
    </Text>
  );
}
