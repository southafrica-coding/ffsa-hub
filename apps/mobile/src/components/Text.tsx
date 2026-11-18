import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { HEADING_VARIANTS, maxFontScale, textStyle, type TextTone, type TextVariant } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
};

/**
 * All app text. Scales with the OS font-size setting (capped only for the big
 * display sizes). Page titles get the "header" role for screen readers.
 * `eyebrow`, `label` and `note` are secondary text unless a tone is given.
 */
export function Text({ variant = "body", tone = "default", style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      accessibilityRole={HEADING_VARIANTS.has(variant) ? "header" : undefined}
      allowFontScaling
      maxFontSizeMultiplier={maxFontScale[variant]}
      {...rest}
      style={[textStyle(variant, tone, colors), style]}
    />
  );
}
