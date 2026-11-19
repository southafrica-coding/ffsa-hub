import { Smartphone } from "lucide-react-native";
import { View } from "react-native";

import { Text } from "@/components";
import { fontFamily, fontSize, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/** The kit's section title (15/600, sentence case) with a quiet count beside it. */
export function CountedSectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}, ${count}`}
      style={{ minHeight: touch.floor, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}
    >
      <Text variant="sectionTitle" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <Text variant="caption" tone="secondary">
        {count}
      </Text>
    </View>
  );
}

/** In-content heading (17/600, sentence case): "Who's on the door?", the camera screens. */
export function Heading({ children }: { children: string }) {
  return (
    <Text variant="sectionTitle" accessibilityRole="header" style={{ fontSize: fontSize.sheetTitle, lineHeight: 24 }}>
      {children}
    </Text>
  );
}

/** "Saved on this phone": the calm cue that tickets open with no signal. */
export function SavedCue({ text, hint, centered = false }: { text: string; hint?: string; centered?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      testID="saved-cue"
      accessible
      accessibilityLabel={hint ? `${text}. ${hint}` : text}
      style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: centered ? "center" : "flex-start", gap: 6 }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 2 }}>
        <Smartphone size={14} color={colors.textSecondary} />
      </View>
      <Text variant="caption" tone="secondary" style={{ flexShrink: 1 }}>
        <Text variant="caption" tone="secondary" style={{ fontFamily: fontFamily.bodyBold }}>
          {text}
        </Text>
        {hint ? `. ${hint}` : ""}
      </Text>
    </View>
  );
}
