import { ChevronRight, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";

import type { TextTone } from "@/theme/styles";
import { fontFamily, hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { LIST_ROW_MIN_HEIGHT } from "./ListGroup";
import { Text } from "./Text";

const rowBox: ViewStyle = {
  minHeight: LIST_ROW_MIN_HEIGHT,
  flexDirection: "row",
  alignItems: "center",
  gap: space.md,
  paddingVertical: 10,
  paddingLeft: space.lg,
  paddingRight: space.md,
};

export type GroupRowProps = {
  children: ReactNode;
  /** Before the body (IconTile, a date block). */
  lead?: ReactNode;
  /** After the body (a figure, a date, a chip). */
  trail?: ReactNode;
  onPress?: () => void;
  /** The row's whole sentence: it's read as one element. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * A free-form row inside a ListGroup, for when ListRow's title + caption
 * isn't enough (a team with its budget bar, an attendance day). Same metrics
 * as ListRow (56pt+, 16/12 side padding, chevron when it opens something),
 * and a plain View, not a button, when it only tells.
 */
export function GroupRow({ children, lead, trail, onPress, accessibilityLabel, accessibilityHint, testID }: GroupRowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {lead}
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>{children}</View>
      {trail ? <View style={{ alignItems: "flex-end", gap: space.xs, flexShrink: 0, maxWidth: "45%" }}>{trail}</View> : null}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} testID={testID} style={rowBox}>
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
      style={({ pressed }) => ({ ...rowBox, backgroundColor: pressed ? colors.surfaceStrong : "transparent" })}
    >
      {content}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronRight size={18} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

/** The 36pt icon tile that leads a row, as ListRow draws it. Decorative. */
export function IconTile({ icon: Icon, children }: { icon?: LucideIcon; children?: ReactNode }) {
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
      {Icon ? <Icon size={20} color={colors.text} /> : children}
    </View>
  );
}

/**
 * A row that only tells (a roster line, the finance-office placeholder):
 * icon tile, title, caption and a quiet trailing note, read as one line.
 * ListRow is a Pressable even without onPress; this is a plain View.
 */
export function InfoRow({
  icon,
  title,
  subtitle,
  meta,
  accessibilityLabel,
  testID,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  meta?: string;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(". ")} testID={testID} style={rowBox}>
      {icon ? <IconTile icon={icon} /> : null}
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

export type StatusLineTone = "positive" | "attention" | "danger" | "secondary";

/** A status in words with its icon ("2 receipts waiting"): never colour alone. */
export function StatusLine({ icon: Icon, tone, children, testID }: { icon: LucideIcon; tone: StatusLineTone; children: string; testID?: string }) {
  const { colors } = useTheme();
  const color = { positive: colors.positiveText, attention: colors.attention, danger: colors.danger, secondary: colors.textSecondary }[tone];
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={14} color={color} />
      </View>
      <Text variant="caption" tone={tone as TextTone} style={{ fontFamily: fontFamily.bodyMedium, flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  );
}
