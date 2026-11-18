// Small building blocks shared by the shell's screens (Home, Me) and open to
// the other slices. Kept here rather than in src/components so the shared kit
// isn't edited by three parallel branches; promote them later if they stick.

import { ChevronRight, ExternalLink, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Button, Text } from "@/components";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { shellStrings } from "./strings";

/** Black section-header bar with a mono caps label (web pattern). */
export function SectionBar({ label, right }: { label: string; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.inverse,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <Text variant="monoLabel" tone="onInverse" accessibilityRole="header">
        {label}
      </Text>
      {right}
    </View>
  );
}

/** A text button for the right side of a SectionBar (light text on the black bar). */
export function BarAction({
  label,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: touch.minTarget - 8,
        minWidth: touch.minTarget,
        justifyContent: "center",
        paddingHorizontal: 8,
        marginVertical: -4,
        borderWidth: hairline,
        borderColor: pressed ? colors.onInverse : "transparent",
      })}
    >
      <Text variant="monoLabel" tone="onInverse" style={{ textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export type ListRowProps = {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** "push" = chevron (in-app), "web" = opens in browser (icon + cue text). */
  trailing?: "push" | "web" | "none";
  onPress?: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

/** A full-width tappable row, 56dp+ high, hairline below. */
export function ListRow({
  title,
  subtitle,
  icon: Icon,
  trailing = "push",
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: ListRowProps) {
  const { colors } = useTheme();
  const tint = disabled ? colors.textTertiary : colors.text;
  const web = trailing === "web";
  return (
    <Pressable
      testID={testID}
      accessibilityRole={web ? "link" : "button"}
      accessibilityLabel={web ? `${title}. ${shellStrings.opensInBrowser}` : title}
      // The subtitle is part of what the row says, so it stays in the hint even
      // when the caller adds its own.
      accessibilityHint={
        [subtitle, accessibilityHint ?? (web ? shellStrings.opensInBrowserHint : undefined)].filter(Boolean).join(". ") ||
        undefined
      }
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.minTarget + 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      {Icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon size={20} color={tint} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" style={{ color: tint }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
        {web ? (
          <Text variant="caption" tone="secondary">
            {shellStrings.opensInBrowser}
          </Text>
        ) : null}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {trailing === "push" ? <ChevronRight size={20} color={colors.textSecondary} /> : null}
        {web ? <ExternalLink size={18} color={colors.textSecondary} /> : null}
      </View>
    </Pressable>
  );
}

/** Centered message for empty / error / no-access states, with an optional action. */
export function StateMessage({
  title,
  body,
  actionLabel,
  onAction,
  icon: Icon,
  testID,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 8 }}>
      {Icon ? (
        <View
          style={{ padding: 12, backgroundColor: colors.surface }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon size={22} color={colors.text} />
        </View>
      ) : null}
      <Text variant="bodyStrong" style={{ textAlign: "center" }} accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text tone="secondary" style={{ textAlign: "center" }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: 8 }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Static skeleton rows while something loads. No shimmer on purpose: nothing
 * moves, so reduce-motion is respected without a check.
 */
export function SkeletonRows({ count = 4, label }: { count?: number; label: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} testID="skeleton" style={{ gap: 14 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ gap: 6, paddingVertical: 4 }}>
          <View style={{ height: 14, width: i % 2 ? "55%" : "70%", backgroundColor: colors.surfaceStrong }} />
          <View style={{ height: 10, width: i % 2 ? "80%" : "65%", backgroundColor: colors.surface }} />
        </View>
      ))}
    </View>
  );
}
