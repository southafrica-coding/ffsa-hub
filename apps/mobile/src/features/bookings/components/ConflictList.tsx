import { TriangleAlert, X } from "lucide-react-native";
import { View } from "react-native";

import { Text } from "@/components";
import { hairline, radius } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { humanDate } from "../logic";
import { strings } from "../strings";
import type { Conflict } from "../types";

import { useAnnounceOnIOS } from "./ui";

const SHOW = 8;

/**
 * Clashes the server found, in its words (frames 7.3, 7.8, 7.11). A hard
 * block (auto-confirm space) gets a red edge and a cross; a warning (the
 * manager will review) an ink edge and a triangle. Icon + title say which,
 * not the colour.
 */
export function ConflictList({ conflicts, blocked, title }: { conflicts: Conflict[]; blocked: boolean; title?: string }) {
  const { colors } = useTheme();
  const heading = title ?? (blocked ? strings.clash.blockedTitle : strings.clash.warnTitle);
  // Android reads the live region below; iOS needs it spoken.
  useAnnounceOnIOS(conflicts.length > 0 ? heading : null);
  if (conflicts.length === 0) return null;
  const Icon = blocked ? X : TriangleAlert;
  return (
    <View
      testID={blocked ? "clash-blocked" : "clash-warning"}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        borderWidth: hairline,
        borderColor: colors.rule,
        borderLeftWidth: 4,
        borderLeftColor: blocked ? colors.danger : colors.text,
        borderRadius: radius.control,
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 4,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 3 }}>
          <Icon size={18} color={blocked ? colors.danger : colors.text} />
        </View>
        {/* The container isn't one accessibility element (its lines are read
            one by one), so the heading carries the alert role too. */}
        <Text variant="rowTitle" tone={blocked ? "danger" : "default"} style={{ flex: 1 }} accessibilityRole="alert">
          {heading}
        </Text>
      </View>
      {conflicts.slice(0, SHOW).map((c, i) => (
        <Text key={`${c.existingId}-${i}`} variant="caption">
          {strings.clash.line(humanDate(c.date), c.existingTitle, c.who, c.existingTime, c.occupiedUntil)}
        </Text>
      ))}
      {conflicts.length > SHOW ? (
        <Text variant="caption" tone="secondary">
          {strings.clash.more(conflicts.length - SHOW)}
        </Text>
      ) : null}
      {title ? null : (
        <Text variant="caption" tone="secondary">
          {blocked ? strings.clash.blockedHelp : strings.clash.warnHelp}
        </Text>
      )}
    </View>
  );
}
