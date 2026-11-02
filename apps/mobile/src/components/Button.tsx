import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { buttonStyle, type ButtonVariant } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { Text } from "./Text";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** 48dp minimum target, square-ish corners, no shadow. */
export function Button({
  label,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [buttonStyle(variant, colors, { pressed, disabled: isDisabled }).container, style]}
    >
      {({ pressed }) => {
        const s = buttonStyle(variant, colors, { pressed, disabled: isDisabled });
        return (
          <>
            {loading ? <ActivityIndicator color={s.textColor} /> : icon}
            <Text variant="label" tone={s.tone} style={{ fontSize: 13 }}>
              {label}
            </Text>
          </>
        );
      }}
    </Pressable>
  );
}
