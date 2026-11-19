import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Text as RNText, View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { selectionHaptic } from "@/components";
import { fontFamily, fontSize, hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { badgeText, useTabBadge } from "./badges";
import { useMe } from "./me-context";
import { shellStrings } from "./strings";
import { focusedPath, hidesTabBar, isTabRoot, TABS, tabForRoute, visibleTabs, type TabDef } from "./tabs";

// The bottom tab bar (spec §5): 48pt + home indicator, top hairline. The
// active tab is marked by a 3pt yellow tick on the top edge AND a bold label
// AND a heavier icon (never colour alone). Order and visibility come from
// TABS, not from the navigator. Hidden routes (Bookings, Schools, …) mark
// Home active; full-screen moments (ticket QR, scanner, long forms) hide it.

/** Tab labels grow with Dynamic Type up to 13pt, then stop (mockup: min(11×dt, 13)). */
export const TAB_LABEL_MAX_SCALE = 13 / fontSize.tab;

export type TabBarProps = BottomTabBarProps & { tabs?: readonly TabDef[] };

export function TabBar({ state, descriptors, emitter, navigateToTab, insets, tabs = TABS }: TabBarProps) {
  const { colors } = useTheme();
  const { me } = useMe();
  const focusedRoute = state.routes[state.index];
  const focusedKey = focusedRoute?.key;
  const focusedTab = focusedRoute ? tabForRoute(focusedRoute.name, tabs) : undefined;
  const optionsHide = focusedKey ? (descriptors?.[focusedKey]?.options?.tabBarStyle as { display?: string } | undefined)?.display === "none" : false;
  if (optionsHide || hidesTabBar(focusedPath(state as Parameters<typeof focusedPath>[0]))) return null;

  const items = visibleTabs(me, tabs)
    .map((tab) => ({ tab, route: state.routes.find((r) => isTabRoot(r.name, tab)) }))
    .filter((x): x is { tab: TabDef; route: (typeof state.routes)[number] } => !!x.route);

  return (
    <View
      testID="tab-bar"
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: colors.bg,
        borderTopWidth: hairline,
        borderTopColor: colors.rule,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {items.map(({ tab, route }, i) => (
        <TabButton
          key={tab.id}
          tab={tab}
          position={`${i + 1} of ${items.length}`}
          focused={focusedTab?.id === tab.id}
          onPress={() => {
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (route.key !== focusedKey && !event.defaultPrevented) {
              selectionHaptic();
              navigateToTab(route.key);
            }
          }}
          onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
        />
      ))}
    </View>
  );
}

function TabButton({
  tab,
  focused,
  position,
  onPress,
  onLongPress,
}: {
  tab: TabDef;
  focused: boolean;
  position: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const badge = useTabBadge(tab.id);
  const Icon = tab.icon;
  const tint = focused ? colors.text : colors.textSecondary;

  return (
    <Pressable
      testID={`tab-${tab.id}`}
      accessibilityRole="tab"
      accessibilityLabel={shellStrings.tabA11y(tab.label, badge)}
      accessibilityHint={`Tab ${position}`}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: touch.minTarget,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 6,
        paddingBottom: 4,
        paddingHorizontal: 2,
        gap: 2,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      {/* Active marker: 3pt yellow tick on the top edge (decoration; the bold label and role carry the state). */}
      {focused ? (
        <View
          testID={`tab-tick-${tab.id}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: -hairline,
            alignSelf: "center",
            width: 28,
            height: 3,
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
            backgroundColor: colors.accent,
          }}
        />
      ) : null}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={24} color={tint} strokeWidth={focused ? 2.5 : 2} />
        {badge > 0 ? (
          <View
            testID={`tab-badge-${tab.id}`}
            style={{
              position: "absolute",
              top: -5,
              left: 15,
              minWidth: 20,
              minHeight: 18,
              paddingHorizontal: 5,
              borderRadius: 9,
              borderWidth: 2,
              borderColor: colors.bg,
              // Ink pill in light, cream in dark (inverse), with its own contrasting text.
              backgroundColor: colors.inverse,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RNText
              maxFontSizeMultiplier={1.2}
              style={{ fontFamily: fontFamily.bodyBold, fontSize: 11, lineHeight: 13, color: colors.onInverse }}
            >
              {badgeText(badge)}
            </RNText>
          </View>
        ) : null}
      </View>
      <RNText
        testID={`tab-label-${tab.id}`}
        numberOfLines={1}
        allowFontScaling
        maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
        style={{
          fontFamily: focused ? fontFamily.bodyExtraBold : fontFamily.bodyMedium,
          fontSize: fontSize.tab,
          lineHeight: 13,
          color: tint,
          textAlign: "center",
        }}
      >
        {tab.label}
      </RNText>
    </Pressable>
  );
}
