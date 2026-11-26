import { Text as RNText, useWindowDimensions, type TextProps as RNTextProps } from "react-native";

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
  // A new native text when the text size changes. iOS keeps a text's old size
  // until the text itself changes, so after the size went DOWN with the app
  // open, untouched text stayed large and the band ran off the edge (QA pass 2).
  const { fontScale } = useWindowDimensions();
  return (
    <RNText
      key={fontScale}
      accessibilityRole={HEADING_VARIANTS.has(variant) ? "header" : undefined}
      allowFontScaling
      maxFontSizeMultiplier={maxFontScale[variant]}
      {...rest}
      style={[textStyle(variant, tone, colors), style]}
    />
  );
}
