import { Pressable, View } from "react-native";

import { space, touch } from "@/theme/tokens";

import { Text } from "./Text";

export type SectionHeaderProps = {
  title: string;
  /** Optional underlined text action on the right ("Mark all read"). */
  actionLabel?: string;
  onAction?: () => void;
  /** 12pt top padding instead of 24 (first section under a title). */
  tight?: boolean;
  /** Side padding: 20 (gutter) by default; 0 inside an already padded screen. */
  inset?: boolean;
  testID?: string;
};

/** 15/600 sentence-case section title. Not caps: the page title is the one caps moment. */
export function SectionHeader({ title, actionLabel, onAction, tight = false, inset = true, testID }: SectionHeaderProps) {
  return (
    <View
      testID={testID}
      style={{
        minHeight: touch.floor,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        paddingTop: tight ? space.md : space.xl,
        paddingBottom: space.sm,
        paddingHorizontal: inset ? space.gutter : 0,
      }}
    >
      <Text variant="sectionTitle" tone="default" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={4}
          style={({ pressed }) => ({ minHeight: touch.floor, justifyContent: "center", paddingLeft: space.md, opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="sectionTitle" tone="default" style={{ textDecorationLine: "underline" }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
