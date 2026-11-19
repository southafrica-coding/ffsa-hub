import { forwardRef, type ElementRef } from "react";
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  type KeyboardAvoidingViewProps,
} from "react-native";

/** What lifts content above the keyboard: padding on iOS, height on Android. */
export function keyboardBehavior(): KeyboardAvoidingViewProps["behavior"] {
  return Platform.OS === "ios" ? "padding" : "height";
}

/**
 * React Native's KeyboardAvoidingView, with a behaviour on both platforms.
 *
 * SDK 58 draws Android apps edge to edge, so the window no longer shrinks when
 * the keyboard opens (adjustResize stops working). A KeyboardAvoidingView with
 * no behaviour on Android then does nothing, and the keyboard covers the field
 * being typed in and the Save button. Jest has no keyboard, so tests can't see
 * it. Always import KeyboardAvoidingView from "@/components" (lint enforces it).
 */
export const KeyboardAvoidingView = forwardRef<ElementRef<typeof RNKeyboardAvoidingView>, KeyboardAvoidingViewProps>(
  function KeyboardAvoidingView({ behavior = keyboardBehavior(), ...rest }, ref) {
    return <RNKeyboardAvoidingView ref={ref} behavior={behavior} {...rest} />;
  },
);
