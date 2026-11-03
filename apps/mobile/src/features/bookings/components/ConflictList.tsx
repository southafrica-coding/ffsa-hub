import { Ban, TriangleAlert } from "lucide-react-native";
import { View } from "react-native";

import { Text } from "@/components";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { humanDate } from "../logic";
import { strings } from "../strings";
import type { Conflict } from "../types";

import { useAnnounceOnIOS } from "./ui";

const SHOW = 8;

/**
 * Clashes the server found, in its words. A hard block (auto-confirm space)
 * gets a red edge and "Ban"; a warning (the manager will review) an ink edge
 * and a triangle. Icon + title say which, not the colour.
 */
export function ConflictList({ conflicts, blocked, title }: { conflicts: Conflict[]; blocked: boolean; title?: string }) {
  const { colors } = useTheme();
  const heading = title ?? (blocked ? strings.clash.blockedTitle : strings.clash.warnTitle);
  // Android reads the live region below; iOS needs it spoken.
  useAnnounceOnIOS(conflicts.length > 0 ? heading : null);
  if (conflicts.length === 0) return null;
  const Icon = blocked ? Ban : TriangleAlert;
  return (
    <View
      testID={blocked ? "clash-blocked" : "clash-warning"}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ borderWidth: hairline, borderLeftWidth: 4, borderColor: blocked ? colors.danger : colors.text, padding: 12, gap: 6, backgroundColor: colors.surface }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon size={18} color={blocked ? colors.danger : colors.text} />
        </View>
        {/* The container isn't one accessibility element (its lines are read
            one by one), so the heading carries the alert role too. */}
        <Text variant="bodyStrong" tone={blocked ? "danger" : "default"} style={{ flex: 1 }} accessibilityRole="alert">
          {heading}
        </Text>
      </View>
      {conflicts.slice(0, SHOW).map((c, i) => (
        <Text key={`${c.existingId}-${i}`} tone="secondary">
          {strings.clash.line(humanDate(c.date), c.existingTitle, c.who, c.existingTime, c.occupiedUntil)}
        </Text>
      ))}
      {conflicts.length > SHOW ? <Text tone="secondary">{strings.clash.more(conflicts.length - SHOW)}</Text> : null}
      {title ? null : (
        <Text variant="caption" tone="secondary">
          {blocked ? strings.clash.blockedHelp : strings.clash.warnHelp}
        </Text>
      )}
    </View>
  );
}
