import { View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { Text, selectionHaptic } from "@/components";
import { fontFamily, hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { DayMarker } from "../day-strip";
import { spokenDate, weekdayOf } from "../logic";
import { strings } from "../strings";

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A compact five-across control (like the tab bar): its text grows a little
// with the OS setting, not without limit, so five days always fit on a 360pt
// screen. The full date and the marker word are in each button's spoken label.
const STRIP_MAX_SCALE = 1.3;
// "Blocked" is the longest word: at 1.2× it still fits a 60pt-wide button.
const MARKER_MAX_SCALE = 1.2;

/**
 * Monday to Friday as five buttons; the chosen day's sets run below. Selected
 * = ink fill; today = underlined weekday. Each day carries at most one marker
 * word (Blocked › No lead › Invited › You), in words for the eye and the ear.
 */
export function DayStrip({
  days,
  selected,
  today,
  markers = {},
  onSelect,
}: {
  days: string[];
  selected: string;
  today: string;
  markers?: Record<string, DayMarker | null>;
  onSelect: (date: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View testID="day-strip" accessibilityRole="tablist" style={{ flexDirection: "row", gap: space.xs }}>
      {days.map((date) => {
        const on = date === selected;
        const isToday = date === today;
        const marker = markers[date] ?? null;
        const word = marker ? strings.week.markers[marker] : null;
        const ink = on ? colors.onInverse : colors.text;
        return (
          <Pressable
            key={date}
            testID={`day-tab-${date}`}
            accessibilityRole="tab"
            accessibilityLabel={strings.week.dayTab(spokenDate(date), isToday, word)}
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              selectionHaptic();
              onSelect(date);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              minHeight: 56,
              paddingVertical: 6,
              gap: 2,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.card,
              backgroundColor: on ? colors.inverse : pressed ? colors.surfaceStrong : "transparent",
            })}
          >
            <Text
              maxFontSizeMultiplier={STRIP_MAX_SCALE}
              style={{
                fontFamily: fontFamily.bodyMedium,
                fontSize: 12,
                lineHeight: 16,
                color: on ? colors.onInverse : colors.textSecondary,
                textDecorationLine: isToday ? "underline" : "none",
              }}
            >
              {WD_SHORT[weekdayOf(date)]}
            </Text>
            <Text
              maxFontSizeMultiplier={STRIP_MAX_SCALE}
              style={{ fontFamily: fontFamily.bodySemibold, fontSize: 17, lineHeight: 22, color: ink, fontVariant: ["tabular-nums"] }}
            >
              {Number(date.slice(8, 10))}
            </Text>
            {/* The marker row is always there, so the five buttons stay one height. */}
            <View
              testID={word ? `day-marker-${date}` : undefined}
              style={{
                maxWidth: "100%",
                paddingHorizontal: 3,
                borderRadius: radius.control,
                borderWidth: hairline,
                ...markerBox(marker, on, colors),
              }}
            >
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MARKER_MAX_SCALE}
                style={{
                  fontFamily: fontFamily.bodyBold,
                  fontSize: 11,
                  lineHeight: 15,
                  color: marker === "you" || marker === "invited" ? (on ? colors.inverse : colors.onInverse) : ink,
                }}
              >
                {word ?? " "}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** You / Invited = filled; No lead = dashed; Blocked = outlined. On the selected (ink) day they invert. */
function markerBox(marker: DayMarker | null, on: boolean, colors: ReturnType<typeof useTheme>["colors"]) {
  const line = on ? colors.onInverse : colors.text;
  switch (marker) {
    case "you":
    case "invited":
      return { backgroundColor: line, borderColor: line };
    case "noLead":
      return { borderStyle: "dashed" as const, borderColor: on ? colors.onInverse : colors.ruleStrong };
    case "blocked":
      return { borderColor: line };
    default:
      return { borderColor: "transparent" };
  }
}
