import { Switch, type SwitchProps } from "react-native";

import { switchColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

export type ToggleProps = Omit<SwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor" | "value"> & {
  value: boolean;
  /** What the switch controls; read by screen readers with its state. */
  accessibilityLabel: string;
};

/** Native Switch in the brand colours: on = ink (light) / yellow (dark). */
export function Toggle({ value, accessibilityLabel, disabled, ...rest }: ToggleProps) {
  const { scheme, colors } = useTheme();
  return (
    <Switch
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      value={value}
      disabled={disabled}
      {...switchColors(colors, scheme, value)}
      {...rest}
    />
  );
}
