import { View } from "react-native";
import { Pressable } from "./Pressable";

import { space, touch } from "@/theme/tokens";

import { Text } from "./Text";
import { useLargeText } from "./useLargeText";

export type SectionHeaderProps = {
  title: string;
  /** Optional underlined text action on the right ("Mark all read"). */
  actionLabel?: string;
  onAction?: () => void;
  /** What VoiceOver says for the action ("Mark all 3 as read"). */
  actionAccessibilityLabel?: string;
  actionTestID?: string;
  /** What VoiceOver reads for the title ("Wednesday 18 November" for "Wed 18 Nov"). */
  accessibilityLabel?: string;
  /** 12pt top padding instead of 24 (first section under a title). */
  tight?: boolean;
  /** Side padding: 20 (gutter) by default; 0 inside an already padded screen. */
  inset?: boolean;
  testID?: string;
};

/**
 * 15/600 sentence-case section title. Not caps: the page title is the one caps moment.
 * The title keeps its words whole: the action wraps under it when the row is
 * full, and always sits under it at large text (QA: "Need/s you/(11)").
 */
export function SectionHeader({ title, actionLabel, onAction, actionAccessibilityLabel, actionTestID, accessibilityLabel, tight = false, inset = true, testID }: SectionHeaderProps) {
  const stacked = useLargeText();
  return (
    <View
      testID={testID}
      style={{
        minHeight: touch.floor,
        flexDirection: stacked ? "column" : "row",
        flexWrap: stacked ? "nowrap" : "wrap",
        alignItems: stacked ? "flex-start" : "center",
        justifyContent: "space-between",
        columnGap: space.md,
        paddingTop: tight ? space.md : space.xl,
        paddingBottom: space.sm,
        paddingHorizontal: inset ? space.gutter : 0,
      }}
    >
      <Text variant="sectionTitle" tone="default" accessibilityRole="header" accessibilityLabel={accessibilityLabel} style={{ flexGrow: 1, flexShrink: 1 }}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          testID={actionTestID}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          onPress={onAction}
          hitSlop={4}
          style={({ pressed }) => ({ minHeight: touch.floor, justifyContent: "center", paddingLeft: stacked ? 0 : space.md, opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="sectionTitle" tone="default" style={{ textDecorationLine: "underline" }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
