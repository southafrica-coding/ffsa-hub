import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { badgeText, useTabBadge } from "./badges";
import { useMe } from "./me-context";
import { shellStrings } from "./strings";
import { TABS, tabForRoute, visibleTabs, type TabDef } from "./tabs";

// The bottom tab bar (web frame 4d): hairline top rule, labelled icons, the
// active tab marked by a yellow tick AND bold ink text (never colour alone).
// Order and visibility come from TABS, not from the navigator, so a route
// arriving as "finance" or "finance/index" lands in the same place.

export type TabBarProps = BottomTabBarProps & { tabs?: readonly TabDef[] };

export function TabBar({ state, emitter, navigateToTab, insets, tabs = TABS }: TabBarProps) {
  const { colors } = useTheme();
  const { me } = useMe();
  const shown = visibleTabs(me, tabs);
  const focusedKey = state.routes[state.index]?.key;

  const items = shown
    .map((tab) => ({ tab, route: state.routes.find((r) => tabForRoute(r.name, tabs)?.id === tab.id) }))
    .filter((x): x is { tab: TabDef; route: (typeof state.routes)[number] } => !!x.route);

  return (
    <View
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
          focused={route.key === focusedKey}
          onPress={() => {
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (route.key !== focusedKey && !event.defaultPrevented) navigateToTab(route.key);
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
        minHeight: touch.minTarget + 8,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 8,
        paddingBottom: 6,
        gap: 3,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      {/* Active marker: the yellow tick from the web's tab bar. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: "25%",
          right: "25%",
          height: 3,
          backgroundColor: focused ? colors.accent : "transparent",
        }}
      />
      <View>
        <Icon size={22} color={tint} strokeWidth={focused ? 2.5 : 2} />
        {badge > 0 ? (
          <View
            testID={`tab-badge-${tab.id}`}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{
              position: "absolute",
              top: -6,
              left: 14,
              minWidth: 20,
              paddingHorizontal: 4,
              paddingVertical: 1,
              backgroundColor: colors.inverse,
              alignItems: "center",
            }}
          >
            <Text variant="label" tone="onInverse" maxFontSizeMultiplier={1.3}>
              {badgeText(badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        variant="label"
        style={{ color: tint, letterSpacing: focused ? 1.6 : 1.4 }}
        numberOfLines={1}
        maxFontSizeMultiplier={1.6}
        // Five tabs on a 320pt phone leave ~64pt each: at large text sizes
        // shrink the label to fit rather than cutting it off.
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}
