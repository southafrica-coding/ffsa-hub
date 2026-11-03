import { useEffect, type ReactNode } from "react";
import { Platform, View } from "react-native";

import { announce, announcement } from "@/lib/a11y/announce";

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
 * tone="danger" is announced to screen readers as it appears (live region on
 * Android, an announcement on iOS).
 */
export function Banner({ tone = "info", title, children, action, testID }: BannerProps) {
  const { colors } = useTheme();
  useRegisterNeedsYouBand(tone === "needsYou");
  const s = bannerStyle(tone, colors);
  const role = tone === "danger" ? "alert" : "summary";
  const live = tone === "danger" ? "assertive" : "polite";
  // VoiceOver ignores Android's live regions: speak danger banners on iOS as
  // they appear or change (string content only).
  const spoken = tone === "danger" ? announcement(title, typeof children === "string" ? children : undefined) : "";
  useEffect(() => {
    if (Platform.OS === "ios") announce(spoken);
  }, [spoken]);

  const message = (
    <>
      {title ? (
        <Text variant="label" tone={s.text}>
          {title}
        </Text>
      ) : null}
      {typeof children === "string" ? <Text tone={s.text}>{children}</Text> : children}
    </>
  );
  return (
    <View
      testID={testID}
      style={s.container}
      // Read as one unit. With a button inside, the message is the unit (so it
      // keeps its alert role and live region) and the button stays reachable.
      accessible={!action}
      accessibilityRole={action ? undefined : role}
      accessibilityLiveRegion={action ? undefined : live}
    >
      {action ? (
        <View accessible accessibilityRole={role} accessibilityLiveRegion={live} style={{ gap: 4 }}>
          {message}
        </View>
      ) : (
        message
      )}
      {action ? <View style={{ marginTop: 8, alignSelf: "flex-start" }}>{action}</View> : null}
    </View>
  );
}
