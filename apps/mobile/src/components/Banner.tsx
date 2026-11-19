import { CircleAlert, CircleCheck, Clock, CloudOff, Info, type LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";

import { announce, announcement } from "@/lib/a11y/announce";
import { bannerStyle, type BannerTone } from "@/theme/styles";
import { touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { useRegisterNeedsYouBand } from "./Screen";
import { Text } from "./Text";

export type BannerProps = {
  tone?: BannerTone;
  /** Optional bold first line. */
  title?: string;
  children?: ReactNode;
  /** Inline text action ("Try again"). */
  actionLabel?: string;
  onAction?: () => void;
  /** The inline action is running ("Send now"): a spinner, and it can't be pressed twice. */
  actionBusy?: boolean;
  /** Any other action (e.g. a Button), shown under the message. */
  action?: ReactNode;
  /** Replace the tone's icon; `null` for none. */
  icon?: LucideIcon | null;
  testID?: string;
};

const TONE_ICON: Record<BannerTone, LucideIcon | null> = {
  info: Info,
  offline: CloudOff,
  error: CircleAlert,
  danger: CircleAlert,
  queued: Clock,
  positive: CircleCheck,
  needsYou: null,
};

const isAlert = (tone: BannerTone) => tone === "error" || tone === "danger";

/**
 * Calm status line with a full 1px border and a leading icon: info, offline
 * ("Offline. Showing what was saved at 08:42."), error (danger border,
 * announced) and queued ("Saved on this phone, not yet sent"). Errors should
 * say what to do and offer Try again (actionLabel + onAction).
 *
 * tone="needsYou" still draws the yellow band for older screens; new code
 * uses NeedsYouBand.
 */
export function Banner({ tone = "info", title, children, actionLabel, onAction, actionBusy = false, action, icon, testID }: BannerProps) {
  const { colors } = useTheme();
  useRegisterNeedsYouBand(tone === "needsYou");
  const s = bannerStyle(tone, colors);
  const alert = isAlert(tone);
  const role = alert ? "alert" : "summary";
  const live = alert ? "assertive" : "polite";
  const Icon = icon === undefined ? TONE_ICON[tone] : icon;
  const inlineAction = actionLabel && onAction ? { label: actionLabel, onPress: onAction } : null;
  // VoiceOver ignores Android's live regions: speak error banners on iOS as
  // they appear or change (string content only).
  const spoken = alert ? announcement(title, typeof children === "string" ? children : undefined) : "";
  useEffect(() => {
    if (Platform.OS === "ios") announce(spoken);
  }, [spoken]);

  const message = (
    <>
      {title ? (
        <Text variant={tone === "needsYou" ? "eyebrow" : "sectionTitle"} tone={s.text}>
          {title}
        </Text>
      ) : null}
      {typeof children === "string" ? (
        <Text variant={tone === "needsYou" ? "rowTitle" : "caption"} tone={s.text}>
          {children}
        </Text>
      ) : (
        children
      )}
    </>
  );
  return (
    <View testID={testID} style={{ ...s.container, flexWrap: "wrap" }}>
      {Icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 1 }}>
          <Icon size={18} color={s.iconColor} />
        </View>
      ) : null}
      {/* The message is read as one unit (keeping its alert role and live
          region); any action stays separately reachable. */}
      <View
        accessible
        accessibilityRole={role}
        accessibilityLiveRegion={live}
        style={{ flex: 1, minWidth: 160, gap: 2, alignSelf: "center" }}
      >
        {message}
      </View>
      {inlineAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={inlineAction.label}
          accessibilityState={{ busy: actionBusy, disabled: actionBusy }}
          disabled={actionBusy}
          onPress={inlineAction.onPress}
          hitSlop={4}
          style={({ pressed }) => ({
            minHeight: touch.floor,
            marginVertical: -10,
            paddingHorizontal: 4,
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {actionBusy ? (
            <ActivityIndicator testID="banner-action-busy" color={colors.text} />
          ) : (
            <Text variant="label" tone="default" style={{ textDecorationLine: "underline" }}>
              {inlineAction.label}
            </Text>
          )}
        </Pressable>
      ) : null}
      {action ? <View style={{ flexBasis: "100%", alignItems: "flex-start" }}>{action}</View> : null}
    </View>
  );
}
