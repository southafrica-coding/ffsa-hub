import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text as RNText, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { useReduceMotion } from "@/lib/a11y";
import { buttonStyle, type ButtonSize, type ButtonVariant } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  /** "small" = 44pt (inline actions, sheets); default 50pt. */
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * 6pt radius, no shadow, sentence-case label. Primary is ink/white in light
 * and yellow/black in dark. Press feedback: fill change plus a .98 scale
 * (no scale under Reduce Motion).
 */
export function Button({
  label,
  variant = "primary",
  size = "default",
  loading = false,
  disabled = false,
  icon,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const isDisabled = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        buttonStyle(variant, colors, { pressed, disabled: isDisabled }, size).container,
        pressed && !reduceMotion ? { transform: [{ scale: 0.98 }] } : null,
        style,
      ]}
    >
      {({ pressed }) => {
        const s = buttonStyle(variant, colors, { pressed, disabled: isDisabled }, size);
        return (
          <>
            {/* The spinner and icon are decoration: the label and busy state say it all. */}
            {loading || icon ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {loading ? <ActivityIndicator color={s.textColor} /> : icon}
              </View>
            ) : null}
            <RNText allowFontScaling style={[s.text, { flexShrink: 1 }]}>
              {label}
            </RNText>
          </>
        );
      }}
    </Pressable>
  );
}
