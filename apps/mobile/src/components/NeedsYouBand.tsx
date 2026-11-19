import { View } from "react-native";
import { Pressable } from "./Pressable";

import { needsYouBandStyle } from "@/theme/styles";
import { fontFamily, fontSize, palette, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { useRegisterNeedsYouBand } from "./Screen";
import { Text } from "./Text";
import { useLargeText } from "./useLargeText";

export type NeedsYouBandProps = {
  /** Caps line, e.g. "Needs you · 3". */
  eyebrow: string;
  /** One line in row-title weight, e.g. "Booking request: Seminar room". */
  text: string;
  /** Optional second line in regular weight (Home: the first unread title). */
  detail?: string;
  /** Optional inline black button (44pt). */
  actionLabel?: string;
  onAction?: () => void;
  /** What VoiceOver says for the button, when the visible label is short ("Open: New booking request"). */
  actionAccessibilityLabel?: string;
  /** What the button does, when it isn't obvious ("Opens the application form on the FFSA Hub website"). */
  actionAccessibilityHint?: string;
  /** What VoiceOver says for the group; defaults to eyebrow + text. */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * THE yellow band: yellow fill, 8pt radius, no border, black text. At most
 * ONE per screen (Screen warns in development), and only when real data
 * drives it. Never invent a signal to fill it.
 */
export function NeedsYouBand({ eyebrow, text, detail, actionLabel, onAction, actionAccessibilityLabel, actionAccessibilityHint, accessibilityLabel, testID }: NeedsYouBandProps) {
  const { colors } = useTheme();
  // At large text the button goes under the text, which keeps the full width
  // (QA: one or two words per line beside "Open").
  const stacked = useLargeText();
  useRegisterNeedsYouBand(true);
  return (
    <View
      // A new band when the layout flips: iOS kept the stacked band's old
      // measurements when the text size went down with the app open, so the
      // text ran off the right edge (QA pass 2).
      key={stacked ? "stacked" : "row"}
      testID={testID}
      style={{
        ...needsYouBandStyle(colors),
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        flexWrap: stacked ? "nowrap" : "wrap",
        gap: 12,
      }}
    >
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={accessibilityLabel ?? [eyebrow, text, detail].filter(Boolean).join(". ")}
        style={stacked ? { alignSelf: "stretch", gap: 2 } : { flex: 1, minWidth: 180, gap: 2 }}
      >
        <Text variant="eyebrow" tone="onAccent">
          {eyebrow}
        </Text>
        <Text variant="rowTitle" tone="onAccent">
          {text}
        </Text>
        {detail ? (
          <Text tone="onAccent" style={{ fontSize: fontSize.sectionTitle, lineHeight: 22 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          accessibilityHint={actionAccessibilityHint}
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
