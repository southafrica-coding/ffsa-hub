// THE Reanimated stand-in for every test. Reanimated's own Jest mock doesn't
// load under this SDK's worklets build ("loadUnpackersWithCode"), so
// jest.setup.ts registers this file as both "react-native-reanimated" and
// "react-native-reanimated/mock" (expo-router/testing-library re-mocks
// Reanimated with the latter, and falls back to an empty object when it
// can't load). Shared values are plain objects, animated styles are computed
// once, scroll handlers and layout animations are inert. A test file can
// still jest.mock("react-native-reanimated") its own way.

import { FlatList, Image, ScrollView, SectionList, Text, View } from "react-native";

const Animated = { View, Text, ScrollView, FlatList, SectionList, Image };

/** FadeIn.duration(160).reduceMotion(…) and friends: chainable, inert. */
function layoutAnimation(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const name of ["duration", "delay", "reduceMotion", "easing", "withCallback"]) chain[name] = () => chain;
  return chain;
}

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  Extrapolation: { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" },
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
  FadeIn: layoutAnimation(),
  FadeOut: layoutAnimation(),
  interpolate: (x: number, input: number[], output: number[]) => {
    if (x <= input[0]) return output[0];
    if (x >= input[input.length - 1]) return output[output.length - 1];
    const t = (x - input[0]) / (input[input.length - 1] - input[0]);
    return output[0] + t * (output[output.length - 1] - output[0]);
  },
  useSharedValue: <T,>(v: T) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useAnimatedScrollHandler: () => () => {},
  useAnimatedRef: () => ({ current: null }),
  useReducedMotion: () => false,
  withTiming: <T,>(v: T) => v,
  withSpring: <T,>(v: T) => v,
};
