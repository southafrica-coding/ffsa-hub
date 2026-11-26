// Building blocks for the Me screens (redesign frames 6.1–6.22): inset lists
// placed in a gutter-padded page, a quiet info card, a bullet list and the
// in-content label. (SwitchRow, RadioRow and StaticRow are in the kit now.)

import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

import { BLEED, ListGroup, SectionHeader, SkeletonList, Text, type SectionHeaderProps } from "@/components";
import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/** Inset lists and cards sit at 16pt in a 20pt-gutter page (the kit's BLEED). */
export const GROUP_BLEED = BLEED;

/** An inset list (kit ListGroup) placed inside a gutter-padded page. */
export function Group({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return (
    <ListGroup inset={false} testID={testID} style={{ marginHorizontal: GROUP_BLEED, ...style }}>
      {children}
    </ListGroup>
  );
}

/** Loading rows in the final list layout, placed like a Group. */
export function GroupSkeleton({ count, label }: { count?: number; label: string }) {
  return (
    <View style={{ marginHorizontal: GROUP_BLEED }}>
      <SkeletonList count={count} label={label} inset={false} />
    </View>
  );
}

/** Section title inside a gutter-padded page. */
export function Section(props: Omit<SectionHeaderProps, "inset">) {
  return <SectionHeader {...props} inset={false} />;
}

/** 13/600 sentence-case label above a block that isn't a text field (photo slot, entry group). */
export function BlockLabel({ children }: { children: string }) {
  return (
    <Text variant="label" accessibilityRole="header" style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
      {children}
    </Text>
  );
}

/** A quiet bordered card for a short explanation with one action. */
export function InfoCard({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        marginHorizontal: GROUP_BLEED,
        gap: space.sm,
        padding: space.md,
        borderWidth: hairline,
        borderColor: colors.rule,
        borderRadius: radius.card,
        backgroundColor: colors.raised,
      }}
    >
      {children}
    </View>
  );
}

/** Plain bullets; each item is read as one line. */
export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <View style={{ gap: space.xs }}>
      {items.map((item) => (
        <View key={item} accessible accessibilityLabel={item} style={{ flexDirection: "row", gap: space.sm }}>
          <Text style={{ fontSize: 14, lineHeight: 20 }}>•</Text>
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
