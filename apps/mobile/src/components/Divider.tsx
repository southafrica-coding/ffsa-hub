import { View } from "react-native";

import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/** Hairline rule (default) or the 2px black rule used to separate sections. */
export function Divider({ strong = false }: { strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      testID="divider"
      accessible={false}
      importantForAccessibility="no"
      style={{
        height: strong ? 2 : hairline,
        backgroundColor: strong ? colors.text : colors.rule,
        alignSelf: "stretch",
      }}
    />
  );
}
