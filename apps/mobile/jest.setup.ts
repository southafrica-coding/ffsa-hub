// Test-only env: placeholder values, never real keys.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-not-a-real-key-0000";
process.env.EXPO_PUBLIC_API_BASE_URL = "https://hub.example.test";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// In-memory keychain stand-in.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

// Real crypto from Node behind expo-crypto's API, so the storage tests
// exercise genuine AES/HMAC round-trips.
jest.mock("expo-crypto", () => {
  const nodeCrypto = require("crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digest: async (_alg: string, data: Uint8Array) =>
      new Uint8Array(nodeCrypto.createHash("sha256").update(data).digest()).buffer,
  };
});

// Reanimated's own Jest mock doesn't load under this SDK's worklets build
// ("loadUnpackersWithCode"), so the kit's collapsing header (and any screen
// importing @/components) gets this minimal stand-in: shared values are plain
// objects, animated styles are computed once, scroll handlers are inert.
// A test file can still jest.mock("react-native-reanimated") its own way.
// The stand-in is registered as "react-native-reanimated/mock" too, because
// expo-router/testing-library re-mocks Reanimated with that module (and falls
// back to an empty object when it can't load).
jest.mock("react-native-reanimated", () => jest.requireMock("react-native-reanimated/mock"));
jest.mock("react-native-reanimated/mock", () => {
  const RN = jest.requireActual("react-native");
  const Animated = { View: RN.View, Text: RN.Text, ScrollView: RN.ScrollView, FlatList: RN.FlatList, Image: RN.Image };
  return {
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
});
