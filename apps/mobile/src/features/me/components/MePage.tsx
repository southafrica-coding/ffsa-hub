// A screen pushed on the Me stack (redesign frames 6.3–6.22): a 44pt bar with
// the back chevron + parent name and the screen's name centred in sentence
// case, over a keyboard-aware scrolling page. These settings-style pages have
// no large caps title; the Me tab root keeps the kit's LargeTitle.

import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NavBar, NeedsYouBandScope, Text } from "@/components";
import { refreshControlColors } from "@/theme/styles";
import { fontFamily, fontSize, hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { meStrings } from "../strings";

export function MePage({
  title,
  backLabel = meStrings.back,
  children,
  refreshing,
  onRefresh,
  tabBarHidden = false,
}: {
  /** The screen's name, shown in the bar and read as the page heading. */
  title: string;
  /** The parent screen's name beside the chevron (default "Me"). */
  backLabel?: string;
  children: ReactNode;
  /** Pull-to-refresh (both or neither). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Full-height forms hide the tab bar, so the page pads the home indicator itself. */
  tabBarHidden?: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  return (
    <NeedsYouBandScope>
      <SafeAreaView edges={tabBarHidden ? ["top", "bottom"] : ["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: space.gutter }}>
          <NavBar
            back={{ label: backLabel, onPress: () => router.back() }}
            title={
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={{ fontFamily: fontFamily.bodySemibold, fontSize: fontSize.navTitle }}
              >
                {title}
              </Text>
            }
          />
        </View>
        {/* The bar's hairline shows once content has scrolled under it. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: hairline, backgroundColor: scrolled ? colors.rule : "transparent" }}
        />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={32}
            onScroll={(e) => {
              const now = e.nativeEvent.contentOffset.y > 2;
              if (now !== scrolled) setScrolled(now);
            }}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.xxl }}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />
              ) : undefined
            }
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </NeedsYouBandScope>
  );
}
