import type { ReactNode } from "react";
import { View } from "react-native";

import { bannerStyle, type BannerTone } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { useRegisterNeedsYouBand } from "./Screen";
import { Text } from "./Text";

export type BannerProps = {
  tone?: BannerTone;
  /** Short mono caps line, e.g. "NEEDS YOU". */
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  testID?: string;
};

/**
 * Status band. tone="needsYou" is the yellow "needs you" band: at most ONE
 * per screen, black text on yellow, and only when real data drives it.
 * tone="danger" is announced to screen readers as it appears.
 */
export function Banner({ tone = "info", title, children, action, testID }: BannerProps) {
  const { colors } = useTheme();
  useRegisterNeedsYouBand(tone === "needsYou");
  const s = bannerStyle(tone, colors);
  return (
    <View
      testID={testID}
      style={s.container}
      // Read as one unit, unless it holds a button that must stay reachable.
      accessible={!action}
      accessibilityRole={tone === "danger" ? "alert" : "summary"}
      accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"}
    >
      {title ? (
        <Text variant="label" tone={s.text}>
          {title}
        </Text>
      ) : null}
      {typeof children === "string" ? <Text tone={s.text}>{children}</Text> : children}
      {action ? <View style={{ marginTop: 8, alignSelf: "flex-start" }}>{action}</View> : null}
    </View>
  );
}
