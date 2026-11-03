import { View } from "react-native";

import { Text } from "@/components";
import { useTheme } from "@/theme/use-theme";

/** The web's black section bar: mono caps label, optional meta on the right. */
export function SectionBar({ title, meta }: { title: string; meta?: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: colors.inverse,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginTop: 8,
      }}
    >
      <Text variant="label" tone="onInverse">
        {title}
      </Text>
      {meta ? (
        <Text variant="label" tone="onInverse">
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

/** Small "Saved on this phone" cue: icon-free text so it reads the same everywhere. */
export function SavedCue({ text, hint }: { text: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View testID="saved-cue" accessible accessibilityLabel={hint ? `${text}. ${hint}` : text} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 8, height: 8, backgroundColor: colors.text }} />
      <Text variant="label" tone="secondary">
        {text}
      </Text>
    </View>
  );
}
