import { View } from "react-native";

import { useTheme } from "@/theme/use-theme";

import { Text } from "./Text";

/** Web masthead pattern: yellow tick + mono context line + big condensed title. */
export function Masthead({ context, title }: { context: string; title: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.text }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View testID="masthead-tick" style={{ width: 16, height: 3, backgroundColor: colors.accent }} />
        <Text variant="label" tone="secondary">
          {context}
        </Text>
      </View>
      <Text variant="display">{title}</Text>
    </View>
  );
}
