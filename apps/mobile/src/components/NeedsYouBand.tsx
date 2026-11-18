import { Pressable, View } from "react-native";

import { needsYouBandStyle } from "@/theme/styles";
import { fontFamily, palette, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { useRegisterNeedsYouBand } from "./Screen";
import { Text } from "./Text";

export type NeedsYouBandProps = {
  /** Caps line, e.g. "Needs you · 3". */
  eyebrow: string;
  /** One line in row-title weight, e.g. "Booking request: Seminar room". */
  text: string;
  /** Optional inline black button (44pt). */
  actionLabel?: string;
  onAction?: () => void;
  /** What VoiceOver says for the group; defaults to eyebrow + text. */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * THE yellow band: yellow fill, 8pt radius, no border, black text. At most
 * ONE per screen (Screen warns in development), and only when real data
 * drives it. Never invent a signal to fill it.
 */
export function NeedsYouBand({ eyebrow, text, actionLabel, onAction, accessibilityLabel, testID }: NeedsYouBandProps) {
  const { colors } = useTheme();
  useRegisterNeedsYouBand(true);
  return (
    <View
      testID={testID}
      style={{ ...needsYouBandStyle(colors), flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}
    >
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={accessibilityLabel ?? `${eyebrow}. ${text}`}
        style={{ flex: 1, minWidth: 180, gap: 2 }}
      >
        <Text variant="eyebrow" tone="onAccent">
          {eyebrow}
        </Text>
        <Text variant="rowTitle" tone="onAccent">
          {text}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => ({
            minHeight: touch.floor,
            minWidth: touch.floor,
            paddingHorizontal: 16,
            borderRadius: radius.control,
            alignItems: "center",
            justifyContent: "center",
            // Black button with a white label in both schemes: it sits on yellow.
            backgroundColor: palette.ink,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text variant="sectionTitle" style={{ color: palette.white, fontFamily: fontFamily.bodyBold }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
