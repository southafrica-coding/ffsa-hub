import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ScrollView, useWindowDimensions, View, type LayoutChangeEvent, type ScrollViewInstance, type ViewStyle } from "react-native";
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
    flexGrow: 1,
    gap: TRACK_PAD,
    padding: TRACK_PAD,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.rule,
    borderRadius: radius.card,
  };
}

// A word never breaks in half (QA, Nov 2026: "Tod/ay", "Practi/ce" at large
// text). Segments are equal shares of the track while every label fits its
// share; a longer label widens its own segment and the track scrolls
// sideways. Labels stay on one line and stop growing at twice the size.
export const SEGMENT_LABEL_MAX_SCALE = 2;
const TRACK_PAD = 3;

/** Each segment's equal share of a track this wide (outer width, border included). */
export function segmentShare(trackWidth: number, count: number): number {
  const inner = trackWidth - 2 * hairline - 2 * TRACK_PAD - TRACK_PAD * (count - 1);
  return Math.max(touch.floor, Math.floor(inner / Math.max(count, 1)));
}

function segmentStyle(colors: Colors, on: boolean, pressed: boolean, share: number | undefined): ViewStyle {
  return {
    flexGrow: 1,
    flexShrink: 0,
    minWidth: share,
    minHeight: touch.floor,
    paddingHorizontal: 12,
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
      numberOfLines={1}
      maxFontSizeMultiplier={SEGMENT_LABEL_MAX_SCALE}
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
 * The track: a sideways ScrollView that only scrolls when the labels don't
 * fit. `selected` is scrolled into view.
 */
function SegmentTrack({
  count,
  selected,
  inset,
  style,
  children,
  ...a11y
}: {
  count: number;
  selected: string | null;
  inset: number;
  style?: ViewStyle;
  children: (share: number | undefined, onSegmentLayout: (key: string) => (e: LayoutChangeEvent) => void) => ReactNode;
} & Pick<ComponentProps<typeof View>, "testID" | "accessibilityRole" | "accessibilityLabel">) {
  const { colors } = useTheme();
  const window = useWindowDimensions();
  // Until the track is measured: its own side margin, or a padded screen's gutter.
  const [width, setWidth] = useState<number>(window.width - 2 * (inset || 20));
  const share = segmentShare(width, count);
  const scroller = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Record<string, number>>({});
  useEffect(() => {
    const x = selected ? offsets.current[selected] : undefined;
    if (x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [selected]);
  return (
    <View
      {...a11y}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ marginHorizontal: inset, ...style }}
    >
      <ScrollView
        ref={scroller}
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={trackStyle(colors)}>
          {children(share, (key) => (e) => {
            offsets.current[key] = e.nativeEvent.layout.x;
          })}
        </View>
      </ScrollView>
    </View>
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
    <SegmentTrack testID={testID} accessibilityRole="tablist" count={items.length} selected={value} inset={inset ? 16 : 0}>
      {(share, onSegmentLayout) => items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            onLayout={onSegmentLayout(item.key)}
            testID={`segment-${item.key}`}
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              selectionHaptic();
              onChange(item.key);
            }}
            style={({ pressed }) => segmentStyle(colors, on, pressed, share)}
          >
            <SegmentLabel on={on}>{item.label}</SegmentLabel>
          </Pressable>
        );
      })}
    </SegmentTrack>
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
      <SegmentTrack accessibilityRole="radiogroup" accessibilityLabel={label} count={options.length} selected={value} inset={0} style={{ opacity: disabled ? 0.45 : 1 }}>
        {(share, onSegmentLayout) => options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onLayout={onSegmentLayout(o.value)}
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
              style={({ pressed }) => segmentStyle(colors, on, pressed, share)}
            >
              <SegmentLabel on={on}>{o.label}</SegmentLabel>
            </Pressable>
          );
        })}
      </SegmentTrack>
    </View>
  );
}
