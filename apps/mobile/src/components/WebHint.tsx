import { ArrowUpRight } from "lucide-react-native";
import { View } from "react-native";

import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { kitStrings } from "./strings";
import { Text } from "./Text";

/** "↗ Opens in browser" (12pt, secondary): the cue under anything that leaves the app. */
export function WebHint({ label = kitStrings.opensInBrowser }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ArrowUpRight size={13} color={colors.textSecondary} />
      </View>
      <Text variant="caption" tone="secondary" style={{ fontSize: 12, lineHeight: 16, fontFamily: fontFamily.bodyMedium }}>
        {label}
      </Text>
    </View>
  );
}
