import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { Pressable } from "./Pressable";

import { fontFamily, fontSize, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { kitStrings } from "./strings";
import { Text } from "./Text";

export type BackAction = {
  /** The parent screen's name, shown beside the chevron ("Home"). */
  label: string;
  onPress: () => void;
};

export type LargeTitleProps = {
  /** Caps context line above the title, with the yellow tick. */
  eyebrow?: string;
  /** The page title. Write it in sentence case: it's drawn uppercase here and
   * shown as written in the collapsed nav bar. */
  title: string;
  /** The 14×3 yellow tick before the eyebrow (default on). */
  tick?: boolean;
  /** 34pt hero title (sign-in, ticket) instead of the 28pt page title. */
  hero?: boolean;
  /** One line of body text under the title. */
  subtitle?: string;
  /** Trailing content on the title row (e.g. an icon button). */
  right?: ReactNode;
  /** Pushed screens: back chevron + parent name above the title. */
  back?: BackAction;
  /** Trailing nav-bar content on pushed screens. */
  navRight?: ReactNode;
  /** Leading nav-bar content instead of the back button (Cancel, Done). */
  navLeft?: ReactNode;
  style?: ViewStyle;
  testID?: string;
};

/**
 * The page header (replaces Masthead): eyebrow + yellow tick + Roboto 900
 * caps title. The one caps moment on a screen. Screens use headerShown:false
 * and render this at the top of their content; the screen supplies the side
 * gutter. For the collapse-on-scroll behaviour use LargeTitleScrollView.
 */
export function LargeTitle({ eyebrow, title, tick = true, hero = false, subtitle, right, back, navRight, navLeft, style, testID }: LargeTitleProps) {
  return (
    <View testID={testID} style={style}>
      {back || navRight || navLeft ? <NavBar back={back} left={navLeft} right={navRight} /> : null}
      <View style={{ paddingTop: 8, paddingBottom: 16, gap: 6 }}>
        {eyebrow ? <Eyebrow text={eyebrow} tick={tick} /> : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <Text variant={hero ? "hero" : "pageTitle"} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {right}
        </View>
        {subtitle ? (
          <Text tone="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** 12pt caps context line; the yellow tick is decoration. */
export function Eyebrow({ text, tick = true }: { text: string; tick?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {tick ? (
        <View
          testID="large-title-tick"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 14, height: 3, backgroundColor: colors.accent }}
        />
      ) : null}
      <Text variant="eyebrow" style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * The 44pt bar over a pushed screen: back chevron + parent name (or any
 * `left` content, e.g. Cancel or Done), optional centred title and trailing
 * actions.
 */
export function NavBar({ back, left, title, right }: { back?: BackAction; left?: ReactNode; title?: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ minHeight: touch.floor, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: -12 }}>
      {left ?? (back ? <BackButton {...back} /> : <View style={{ width: touch.floor }} />)}
      {title ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 88, right: 88, alignItems: "center" }}>
          {title}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>{right}</View>
    </View>
  );
}

export function BackButton({ label, onPress }: BackAction) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={kitStrings.backTo(label)}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: touch.floor,
        minWidth: touch.floor,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronLeft size={26} color={colors.text} />
      </View>
      <Text style={{ fontSize: fontSize.sheetTitle, fontFamily: fontFamily.body }} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  );
}
