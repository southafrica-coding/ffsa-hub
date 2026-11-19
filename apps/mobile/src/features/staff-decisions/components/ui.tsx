// Staff decisions pieces for the redesign (frames 12.1–12.6) that the shared
// kit doesn't have: a Yes / No choice that looks like the kit's segmented
// control but is a radio group that can start with nothing chosen, and the
// saved-copy note. Built from kit components and tokens only.

import { Pressable, View } from "react-native";

import { Text, selectionHaptic } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { StaleNote } from "@/features/finance/components/parts";
import type { LoadState } from "@/features/finance/use-cached-load";
import { fontFamily, fontSize, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

/**
 * A form answer drawn as the kit's SegmentedControl (track, raised segment,
 * 2px yellow underline + bold: never colour alone). The kit one is a tab
 * list and always has a selection; this is a radio group, and `value` may
 * be null until the person chooses.
 */
export function ChoiceSegments<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {/* Read on its own (iOS doesn't speak a radiogroup's label), then each radio. */}
      <Text variant="label" accessibilityRole="header">
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{
          flexDirection: "row",
          gap: 3,
          padding: 3,
          backgroundColor: colors.surface,
          borderWidth: hairline,
          borderColor: colors.rule,
          borderRadius: radius.card,
          opacity: disabled ? 0.45 : 1,
        }}
      >
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
                  fontSize: fontSize.note,
                  lineHeight: 20,
                  textAlign: "center",
                  color: on ? colors.text : colors.textSecondary,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * When what's on screen is the copy saved on this phone: a quiet
 * "Last updated" line, or the offline note with a retry if a refresh failed.
 */
export function Freshness<T>({ state, onRetry }: { state: LoadState<T>; onRetry: () => void }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) return <StaleNote message={strings.common.refreshFailed(when)} onRetry={onRetry} />;
  return (
    <Text variant="caption" tone="secondary" testID="last-updated" style={{ paddingHorizontal: space.xs }}>
      {strings.common.lastUpdated(when)}
    </Text>
  );
}
