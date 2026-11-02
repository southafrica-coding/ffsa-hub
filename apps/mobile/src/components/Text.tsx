import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { maxFontScale, textStyle, type TextTone, type TextVariant } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
};

/**
 * All app text. Scales with the OS font-size setting (capped for the huge
 * display sizes). Headings get the "header" role for screen readers.
 */
export function Text({ variant = "body", tone = "default", style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const isHeading = variant === "display" || variant === "title";
  return (
    <RNText
      accessibilityRole={isHeading ? "header" : undefined}
      allowFontScaling
      maxFontSizeMultiplier={maxFontScale[variant]}
      {...rest}
      style={[textStyle(variant, tone, colors), style]}
    />
  );
}
