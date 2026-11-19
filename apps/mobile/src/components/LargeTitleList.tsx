import { useState, type ReactElement, type ReactNode } from "react";
import { FlatList, View, type ListRenderItem, type RefreshControlProps, type ViewStyle } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useReduceMotion } from "@/lib/a11y";
import { fontFamily, fontSize, hairline, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { LargeTitle, NavBar, type LargeTitleProps } from "./LargeTitle";
import { NeedsYouBandScope } from "./Screen";

// Reanimated's FlatList, typed as React Native's so the generic row type survives.
const AnimatedFlatList = Animated.FlatList as unknown as typeof FlatList;

export type LargeTitleListProps<T> = LargeTitleProps & {
  /** The rows. Only those on screen are rendered (a virtualised list). */
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  /** Everything above the rows (bands, figures, the section title). */
  header?: ReactNode;
  /** Everything below the rows. */
  footer?: ReactNode;
  /** Shown in place of the rows when there are none. */
  empty?: ReactElement | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: ViewStyle;
  edges?: Edge[];
  testID?: string;
};

/**
 * LargeTitleScrollView for long lists: the same collapsing LargeTitle (and
 * nav bar on pushed screens), but the page is a virtualised FlatList, so a
 * team with hundreds of expenses or years of attendance scrolls smoothly.
 * The title and `header` scroll away above the rows; draw the rows as a
 * group with ListGroupItem inside a Bleed.
 */
export function LargeTitleList<T>({
  data,
  renderItem,
  keyExtractor,
  header,
  footer,
  empty,
  refreshControl,
  contentContainerStyle,
  edges = ["top"],
  testID,
  ...titleHeader
}: LargeTitleListProps<T>) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [titleBottom, setTitleBottom] = useState(96);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const collapsed = useAnimatedStyle(() => {
    const y = scrollY.value;
    const opacity = reduceMotion ? (y >= titleBottom ? 1 : 0) : interpolate(y, [titleBottom * 0.6, titleBottom], [0, 1], Extrapolation.CLAMP);
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
      {titleHeader.title}
    </Animated.Text>
  );
  const pushed = Boolean(titleHeader.back || titleHeader.navRight);
  const { back, navRight, ...titleProps } = titleHeader;

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
        <AnimatedFlatList
          testID={testID}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onScroll={onScroll as never}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          contentContainerStyle={[{ paddingHorizontal: space.gutter, paddingBottom: space.xl }, contentContainerStyle]}
          ListHeaderComponent={
            <View>
              <View onLayout={(e) => setTitleBottom(Math.max(1, e.nativeEvent.layout.y + e.nativeEvent.layout.height - space.lg))}>
                <LargeTitle {...titleProps} />
              </View>
              {header}
            </View>
          }
          ListFooterComponent={footer ? <View>{footer}</View> : undefined}
          ListEmptyComponent={empty ?? undefined}
        />
      </SafeAreaView>
    </NeedsYouBandScope>
  );
}
