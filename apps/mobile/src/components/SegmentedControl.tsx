import { View, type ViewStyle } from "react-native";
import { Pressable } from "./Pressable";

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

type Colors = ReturnType<typeof useTheme>["colors"];

function trackStyle(colors: Colors): ViewStyle {
  return {
    flexDirection: "row",
    gap: 3,
    padding: 3,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.rule,
    borderRadius: radius.card,
  };
}

function segmentStyle(colors: Colors, on: boolean, pressed: boolean): ViewStyle {
  return {
    flex: 1,
    minHeight: touch.floor,
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: on ? colors.rule : "transparent",
    // Selected = raised + bold + a 2px yellow underline: never colour alone.
    borderBottomWidth: on ? 2 : hairline,
    borderBottomColor: on ? colors.accent : "transparent",
    backgroundColor: on ? colors.segmentOn : pressed ? colors.surfaceStrong : "transparent",
  };
}

function SegmentLabel({ on, children }: { on: boolean; children: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontFamily: on ? fontFamily.bodyBold : fontFamily.bodyMedium,
        fontSize: 14,
        lineHeight: 20,
        textAlign: "center",
        color: on ? colors.text : colors.textSecondary,
      }}
    >
      {children}
    </Text>
  );
}

/**
 * Subtle track with a rule border; segments are 44pt+. The selected segment
 * is raised, bordered, bold AND carries a 2px yellow underline: never colour
 * alone. A selection haptic on change. A tab list: one is always selected.
 */
export function SegmentedControl<K extends string>({ items, value, onChange, inset = true, testID }: SegmentedControlProps<K>) {
  const { colors } = useTheme();
  return (
    <View testID={testID} accessibilityRole="tablist" style={{ ...trackStyle(colors), marginHorizontal: inset ? 16 : 0 }}>
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
            style={({ pressed }) => segmentStyle(colors, on, pressed)}
          >
            <SegmentLabel on={on}>{item.label}</SegmentLabel>
          </Pressable>
        );
      })}
    </View>
  );
}

export type ChoiceSegmentsProps<T extends string> = {
  /** The question, shown above and read as a heading ("Accepted?"). */
  label: string;
  /** One caption line under the question. */
  hint?: string;
  options: readonly { value: T; label: string }[];
  /** null until the person answers. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  testID?: string;
};

/**
 * A form answer drawn as the segmented control (Yes / No). Unlike the tab
 * list it is a radio group and may start with nothing chosen, so VoiceOver
 * reads "radio button, checked". Option testIDs are `choice-<value>`.
 */
export function ChoiceSegments<T extends string>({ label, hint, options, value, onChange, disabled = false, testID }: ChoiceSegmentsProps<T>) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ gap: 6 }}>
      {/* Read on its own (iOS doesn't speak a radiogroup's label), then each radio. */}
      <View style={{ gap: 2 }}>
        <Text variant="label" accessibilityRole="header">
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ ...trackStyle(colors), opacity: disabled ? 0.45 : 1 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={`choice-${o.value}`}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on, checked: on, disabled }}
              disabled={disabled}
              onPress={() => {
                if (on) return;
                selectionHaptic();
                onChange(o.value);
              }}
              style={({ pressed }) => segmentStyle(colors, on, pressed)}
            >
              <SegmentLabel on={on}>{o.label}</SegmentLabel>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
