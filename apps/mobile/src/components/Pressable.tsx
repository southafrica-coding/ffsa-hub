import { forwardRef, useCallback, useState, type ElementRef } from "react";
import {
  Pressable as RNPressable,
  type GestureResponderEvent,
  type PressableProps as RNPressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type PressableProps = RNPressableProps;

/**
 * Drop-in replacement for React Native's Pressable.
 *
 * NativeWind v4 wraps RN's Pressable (cssInterop className → style) and, on a
 * real device, drops a `style` written as a function of `{ pressed }`. Every
 * row lost its flexDirection: "row" and every tab its flex: 1 (seen on Jack's
 * iPhone, 19 Nov 2026), while Jest — which doesn't run the interop — passed.
 *
 * This component tracks `pressed` itself and hands RN a plain style object, so
 * the interop never sees a function. Children-as-a-function still work.
 * Always import Pressable from "@/components" (lint enforces it).
 */
export const Pressable = forwardRef<ElementRef<typeof RNPressable>, PressableProps>(function Pressable(
  { style, onPressIn, onPressOut, ...rest },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  const handleIn = useCallback(
    (e: GestureResponderEvent) => {
      setPressed(true);
      onPressIn?.(e);
    },
    [onPressIn],
  );
  const handleOut = useCallback(
    (e: GestureResponderEvent) => {
      setPressed(false);
      onPressOut?.(e);
    },
    [onPressOut],
  );
  const resolved: StyleProp<ViewStyle> =
    typeof style === "function"
      ? style({ pressed: pressed || rest.testOnly_pressed === true, hovered: false } as PressableStateCallbackType)
      : style;
  return <RNPressable ref={ref} {...rest} style={resolved} onPressIn={handleIn} onPressOut={handleOut} />;
});
