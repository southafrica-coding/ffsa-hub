import { ChevronLeft } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { useWindowDimensions, View, type ViewStyle } from "react-native";
import { Pressable } from "./Pressable";

import { maxFontScale, textVariants } from "@/theme/styles";
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

const TICK_HEIGHT = 3;

/** Top offset that centres the tick on the eyebrow's FIRST line at this text size. */
export function eyebrowTickOffset(fontScale: number): number {
  const scale = Math.min(fontScale, maxFontScale.eyebrow ?? Infinity);
  return Math.max(0, ((textVariants.eyebrow.lineHeight ?? 16) * scale - TICK_HEIGHT) / 2);
}

/**
 * 12pt caps context line; the yellow tick is decoration. A long eyebrow wraps
 * inside the gutter and the tick stays on its first line.
 */
export function Eyebrow({ text, tick = true }: { text: string; tick?: boolean }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      {tick ? (
        <View
          testID="large-title-tick"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 14, height: TICK_HEIGHT, marginTop: eyebrowTickOffset(fontScale), backgroundColor: colors.accent }}
        />
      ) : null}
      <Text variant="eyebrow" style={{ flex: 1, minWidth: 0 }}>
        {text}
      </Text>
    </View>
  );
}

// The centred title's inset from each side of the bar.
const TITLE_INSET = 88;
// Room kept between the back label and the centred title.
const TITLE_GAP = 8;

/**
 * The 44pt bar over a pushed screen: back chevron + parent name (or any
 * `left` content, e.g. Cancel or Done), optional centred title and trailing
 * actions.
 */
export function NavBar({ back, left, title, right }: { back?: BackAction; left?: ReactNode; title?: ReactNode; right?: ReactNode }) {
  const [barWidth, setBarWidth] = useState(0);
  const [titleWidth, setTitleWidth] = useState(0);
  // The back label stops short of the centred title and ends in "…" (QA pass
  // 2: "Household" ran into "Add child" at large text).
  const backMax = title && barWidth && titleWidth ? Math.max(touch.floor, (barWidth - titleWidth) / 2 - TITLE_GAP) : undefined;
  return (
    <View
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      style={{ minHeight: touch.floor, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: -12 }}
    >
      {left ??
        (back ? (
          <View style={{ flexShrink: 1, maxWidth: backMax }}>
            <BackButton {...back} />
          </View>
        ) : (
          <View style={{ width: touch.floor }} />
        ))}
      {title ? (
        <View pointerEvents="none" style={{ position: "absolute", left: TITLE_INSET, right: TITLE_INSET, alignItems: "center" }}>
          <View onLayout={(e) => setTitleWidth(e.nativeEvent.layout.width)}>{title}</View>
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
        flexShrink: 1,
        flexDirection: "row",
        alignItems: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronLeft size={26} color={colors.text} />
      </View>
      <Text style={{ flexShrink: 1, fontSize: fontSize.sheetTitle, fontFamily: fontFamily.body }} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  );
}
