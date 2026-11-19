// The same small Reanimated stand-in as jest.setup.ts, for tests that render
// through expo-router/testing-library. That library re-mocks Reanimated with
// the official mock, which can't load under this SDK, and falls back to an
// empty object; any screen using the kit's LargeTitleScrollView then crashes.
// In such a test file:
//   jest.mock("react-native-reanimated/mock", () => jest.requireActual("../../test/reanimated-mock"));

import { FlatList, Image, ScrollView, Text, View } from "react-native";

const Animated = { View, Text, ScrollView, FlatList, Image };

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  Extrapolation: { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" },
  interpolate: (x: number, input: number[], output: number[]) => {
    if (x <= input[0]) return output[0];
    if (x >= input[input.length - 1]) return output[output.length - 1];
    const t = (x - input[0]) / (input[input.length - 1] - input[0]);
    return output[0] + t * (output[output.length - 1] - output[0]);
  },
  useSharedValue: <T,>(v: T) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useAnimatedScrollHandler: () => () => {},
  useReducedMotion: () => false,
  withTiming: <T,>(v: T) => v,
  withSpring: <T,>(v: T) => v,
};
