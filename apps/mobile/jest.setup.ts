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

// NativeWind's interop, as on a device. It wraps View, Text, Pressable, … and
// rebuilds their `style`, but skips registering them when NODE_ENV is "test",
// so tests used to see React Native's components untouched. That hid the
// Pressable bug (a function `style` became {} on the phone, #668). Register
// them here, so every test renders what the phone renders. (Quietly: reading
// ImageBackground from react-native logs a deprecation warning.)
{
  const warn = console.warn;
  console.warn = () => {};
  require("react-native-css-interop/dist/runtime/components");
  console.warn = warn;
}

// Reanimated: one small stand-in for every test (see test/reanimated-mock.ts).
jest.mock("react-native-reanimated", () => jest.requireActual("./test/reanimated-mock"));
jest.mock("react-native-reanimated/mock", () => jest.requireActual("./test/reanimated-mock"));
