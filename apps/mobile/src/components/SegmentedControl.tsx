import { Pressable, View } from "react-native";

import { fontFamily, hairline, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { selectionHaptic } from "./haptics";
import { Text } from "./Text";

export type Segment<K extends string> = { key: K; label: string; accessibilityLabel?: string };

export type SegmentedControlProps<K extends string> = {
  items: readonly Segment<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Side margin: 16 by default; 0 inside an already padded screen. */
  inset?: boolean;
  testID?: string;
};

/**
 * Subtle track with a rule border; segments are 44pt+. The selected segment
 * is raised, bordered, bold AND carries a 2px yellow underline: never colour
 * alone. A selection haptic on change.
 */
export function SegmentedControl<K extends string>({ items, value, onChange, inset = true, testID }: SegmentedControlProps<K>) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={{
        marginHorizontal: inset ? 16 : 0,
        flexDirection: "row",
        gap: 3,
        padding: 3,
        backgroundColor: colors.surface,
        borderWidth: hairline,
        borderColor: colors.rule,
        borderRadius: radius.card,
      }}
    >
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            testID={`segment-${item.key}`}
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              selectionHaptic();
              onChange(item.key);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: touch.floor,
              paddingHorizontal: 6,
              paddingVertical: 6,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.control,
              borderWidth: hairline,
              borderColor: on ? colors.rule : "transparent",
              borderBottomWidth: on ? 2 : hairline,
              borderBottomColor: on ? colors.accent : "transparent",
              backgroundColor: on ? colors.segmentOn : pressed ? colors.surfaceStrong : "transparent",
            })}
          >
            <Text
              style={{
                fontFamily: on ? fontFamily.bodyBold : fontFamily.bodyMedium,
                fontSize: 14,
                lineHeight: 20,
                textAlign: "center",
                color: on ? colors.text : colors.textSecondary,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
