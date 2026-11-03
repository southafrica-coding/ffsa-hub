import { View } from "react-native";

import { Text } from "@/components";
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
      style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: colors.text }}
    >
      <View style={{ gap: 2 }}>
        <Text variant="label" tone="secondary">
          {strings.checkIn.statsLabel}
        </Text>
        <Text variant="numeral">{stats ? String(stats.checkedIn) : "–"}</Text>
      </View>
      <View style={{ flex: 1, paddingBottom: 6, gap: 2 }}>
        <Text variant="bodyStrong" tone="secondary">
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
