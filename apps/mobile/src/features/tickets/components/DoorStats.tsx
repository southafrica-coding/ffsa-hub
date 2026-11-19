import { View } from "react-native";

import { Text } from "@/components";
import { fontSize, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { DoorStats as Stats } from "../api";
import { strings } from "../strings";

/** "One big number per screen": how many are in, against how many tickets. */
export function DoorStats({ stats, failed, offline }: { stats: Stats | null; failed: boolean; offline: boolean }) {
  const { colors } = useTheme();
  const label = stats ? strings.checkIn.statsA11y(stats.checkedIn, stats.total) : strings.checkIn.statsUnavailable;
  return (
    <View
      testID="door-stats"
      accessible
      accessibilityRole="summary"
      accessibilityLabel={offline || failed ? `${label}. ${strings.checkIn.statsUnavailable}` : label}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: space.md, paddingTop: space.xs, paddingBottom: space.sm, borderBottomWidth: 2, borderBottomColor: colors.text }}
    >
      <View>
        <Text variant="label">{strings.checkIn.statsLabel}</Text>
        <Text variant="kpi" style={{ fontSize: fontSize.numeral, lineHeight: 44 }} maxFontSizeMultiplier={1.4}>
          {stats ? String(stats.checkedIn) : "–"}
        </Text>
      </View>
      <View style={{ flex: 1, paddingBottom: 6, gap: 2 }}>
        <Text variant="sectionTitle" tone="secondary">
          {stats ? strings.checkIn.statsOf(stats.total) : ""}
        </Text>
        {offline || failed ? (
          <Text variant="caption" tone="secondary">
            {offline ? strings.common.offline : strings.checkIn.statsUnavailable}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
