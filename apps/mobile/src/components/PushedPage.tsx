import { useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "./KeyboardAvoidingView";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { refreshControlColors } from "@/theme/styles";
import { fontFamily, fontSize, hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { NavBar, type BackAction } from "./LargeTitle";
import { NeedsYouBandScope } from "./Screen";
import { Text } from "./Text";
import { useScrollToTopOnTabPress } from "./useTabReselect";

/**
 * Lists, bands and banners sit 16pt from the edge while text sits on the
 * 20pt gutter (mockups). Pages pad by the gutter, so cards bleed out by 4.
 */
export const BLEED = space.inset - space.gutter;

export function Bleed({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ marginHorizontal: BLEED }, style]}>{children}</View>;
}

export type PushedPageProps = {
  /** Back chevron + the parent screen's name. */
  back: BackAction;
  /** The screen's name, centred in the bar in sentence case and read as the heading. */
  title?: string;
  children: ReactNode;
  /** Pull-to-refresh (both or neither). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Full-height forms hide the tab bar, so the page pads the home indicator itself. */
  tabBarHidden?: boolean;
  /** Spacing between children (default 16). */
  gap?: number;
  testID?: string;
};

/**
 * A pushed page without a large caps title: the settings-style Me pages, and
 * any pushed screen while its title isn't known yet (loading, error, not
 * found). A 44pt bar (back + optional centred title, hairline once scrolled)
 * over a keyboard-aware scrolling body padded by the gutter.
 */
export function PushedPage({ back, title, children, refreshing, onRefresh, tabBarHidden = false, gap = space.lg, testID }: PushedPageProps) {
  const { colors } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<unknown>(null);
  const offset = useRef(0);
  useScrollToTopOnTabPress(scrollRef, () => offset.current);
  const edges: Edge[] = tabBarHidden ? ["top", "bottom"] : ["top"];

  return (
    <NeedsYouBandScope>
      <SafeAreaView testID={testID} edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: space.gutter }}>
          <NavBar
            back={back}
            title={
              title ? (
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ fontFamily: fontFamily.bodySemibold, fontSize: fontSize.navTitle }}
                >
                  {title}
                </Text>
              ) : undefined
            }
          />
        </View>
        {/* The bar's hairline shows once content has scrolled under it. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: hairline, backgroundColor: scrolled ? colors.rule : "transparent" }}
        />
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef as never}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={32}
            onScroll={(e) => {
              offset.current = e.nativeEvent.contentOffset.y;
              const now = offset.current > 2;
              if (now !== scrolled) setScrolled(now);
            }}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.xxl, gap }}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} /> : undefined
            }
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </NeedsYouBandScope>
  );
}
