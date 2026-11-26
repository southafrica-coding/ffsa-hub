import { View } from "react-native";

import { space, touch } from "@/theme/tokens";

import { Text } from "./Text";
import { useLargeText } from "./useLargeText";

export type SectionTitleProps = {
  title: string;
  /** Quiet count or summary on the right ("3 teams", "2"). Read with the title. */
  meta?: string | number;
  /** What VoiceOver reads instead of "title, meta" ("Wednesday 18 November"). */
  accessibilityLabel?: string;
  /** 12pt top padding instead of 24 (first section under a title). */
  tight?: boolean;
  testID?: string;
};

/**
 * A section title with a quiet count on the right, read as ONE heading
 * ("Outreach teams, 3 teams"). Same metrics as SectionHeader, for screens
 * already padded by the gutter. Use SectionHeader when you need an action.
 */
export function SectionTitle({ title, meta, accessibilityLabel, tight = false, testID }: SectionTitleProps) {
  const hasMeta = meta !== undefined && meta !== "";
  // At large text the count goes under the title, so neither squeezes the other.
  const stacked = useLargeText();
  return (
    <View
      // New layout, new view: iOS keeps old measurements otherwise (see NeedsYouBand).
      key={stacked ? "stacked" : "row"}
      accessible
      accessibilityRole="header"
      accessibilityLabel={accessibilityLabel ?? (hasMeta ? `${title}, ${meta}` : title)}
      testID={testID}
      style={{
        minHeight: touch.floor,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: stacked ? space.xs : space.md,
        paddingTop: tight ? space.md : space.xl,
        paddingBottom: space.sm,
      }}
    >
      <Text variant="sectionTitle" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {hasMeta ? (
        <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
          {String(meta)}
        </Text>
      ) : null}
    </View>
  );
}
