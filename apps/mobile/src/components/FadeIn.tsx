import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";
import Animated, { FadeIn as FadeInAnimation, ReduceMotion } from "react-native-reanimated";

/** Content fades in over the skeleton it replaces (spec §6). */
export const CONTENT_FADE_MS = 160;

const entering = FadeInAnimation.duration(CONTENT_FADE_MS).reduceMotion(ReduceMotion.System);

/**
 * Wrap what replaces a skeleton (the loaded list) so it fades in over 160ms
 * instead of popping. Under Reduce Motion Reanimated skips the fade
 * (ReduceMotion.System), so the content simply appears.
 */
export function FadeIn({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return (
    <Animated.View entering={entering} style={style} testID={testID}>
      {children}
    </Animated.View>
  );
}
