import { useState, type ReactElement, type ReactNode } from "react";
import { View, type RefreshControlProps, type ViewStyle } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useReduceMotion } from "@/lib/a11y";
import { fontFamily, fontSize, hairline, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { LargeTitle, NavBar, type LargeTitleProps } from "./LargeTitle";
import { NeedsYouBandScope } from "./Screen";

export type LargeTitleScrollViewProps = LargeTitleProps & {
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: ViewStyle;
  edges?: Edge[];
  /** Spacing between children (default 16). */
  gap?: number;
};

/**
 * A scrolling page whose LargeTitle collapses into a 16pt nav title as it
 * scrolls away (spec §4, Reanimated). Pushed screens (`back`) keep a 44pt
 * nav bar with the back chevron; tab roots get a bar that only appears once
 * the title has scrolled off. Under Reduce Motion the nav title appears
 * without fading.
 */
export function LargeTitleScrollView({
  children,
  refreshControl,
  contentContainerStyle,
  edges = ["top"],
  gap = space.lg,
  ...header
}: LargeTitleScrollViewProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [titleBottom, setTitleBottom] = useState(96);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const collapsed = useAnimatedStyle(() => {
    const y = scrollY.value;
    const opacity = reduceMotion
      ? y >= titleBottom
        ? 1
        : 0
      : interpolate(y, [titleBottom * 0.6, titleBottom], [0, 1], Extrapolation.CLAMP);
    return { opacity };
  });

  const navTitle = (
    <Animated.Text
      // The large title is the heading; the small copy is a visual echo only.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      style={[{ fontFamily: fontFamily.bodySemibold, fontSize: fontSize.navTitle, color: colors.text }, collapsed]}
    >
      {header.title}
    </Animated.Text>
  );
  const pushed = Boolean(header.back || header.navRight);
  const { back, navRight, ...titleProps } = header;

  return (
    <NeedsYouBandScope>
      <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
        {pushed ? (
          <View style={{ paddingHorizontal: space.gutter, backgroundColor: colors.bg }}>
            <NavBar back={back} right={navRight} title={navTitle} />
            <Animated.View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[{ height: hairline, backgroundColor: colors.rule, marginHorizontal: -space.gutter }, collapsed]}
            />
          </View>
        ) : (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1,
                minHeight: touch.floor,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.bg,
                borderBottomWidth: hairline,
                borderBottomColor: colors.rule,
              },
              collapsed,
            ]}
          >
            {navTitle}
          </Animated.View>
        )}
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[{ paddingHorizontal: space.gutter, paddingBottom: space.xl, gap }, contentContainerStyle]}
        >
          <View onLayout={(e) => setTitleBottom(Math.max(1, e.nativeEvent.layout.y + e.nativeEvent.layout.height - space.lg))}>
            <LargeTitle {...titleProps} />
          </View>
          {children}
        </Animated.ScrollView>
      </SafeAreaView>
    </NeedsYouBandScope>
  );
}
