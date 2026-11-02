import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { hmacSha256, largeSecureStore } from "../secure-storage";

// jest.setup.ts mocks SecureStore (in-memory map), AsyncStorage (official
// mock) and expo-crypto (Node's real crypto).
const secureMap = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const KEY = "sb-test-project-auth-token";

function bigSession(bytes: number) {
  const filler = "x".repeat(bytes);
  return JSON.stringify({
    access_token: `eyJ.${filler}.sig`,
    refresh_token: "refresh-123",
    user: { id: "u1", email: "person@example.org", user_metadata: { note: "émoji ✓ ünïcode" } },
  });
}

beforeEach(async () => {
  secureMap.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("largeSecureStore", () => {
  it("round-trips a payload larger than 4 KB", async () => {
    const value = bigSession(6000);
    expect(value.length).toBeGreaterThan(4096);
    await largeSecureStore.setItem(KEY, value);
    await expect(largeSecureStore.getItem(KEY)).resolves.toBe(value);
  });

  it("keeps only the small key in SecureStore and ciphertext (not plaintext) in AsyncStorage", async () => {
    const value = bigSession(5000);
    await largeSecureStore.setItem(KEY, value);

    const keyEntry = secureMap.get(`${KEY}.key`)!;
    expect(keyEntry).toMatch(/^[0-9a-f]{128}$/); // 2 × 256-bit keys
    const blob = (await AsyncStorage.getItem(KEY))!;
    expect(blob).not.toContain("refresh-123");
    expect(blob).not.toContain("person@example.org");
    expect(JSON.parse(blob)).toMatchObject({ v: 1 });
  });

  it("uses fresh keys and IV on every write", async () => {
    await largeSecureStore.setItem(KEY, "same");
    const first = [secureMap.get(`${KEY}.key`), await AsyncStorage.getItem(KEY)];
    await largeSecureStore.setItem(KEY, "same");
    const second = [secureMap.get(`${KEY}.key`), await AsyncStorage.getItem(KEY)];
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it("returns null (and doesn't throw) with the wrong key", async () => {
    await largeSecureStore.setItem(KEY, bigSession(5000));
    secureMap.set(`${KEY}.key`, "ab".repeat(64));
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it("returns null for tampered ciphertext", async () => {
    await largeSecureStore.setItem(KEY, bigSession(5000));
    const env = JSON.parse((await AsyncStorage.getItem(KEY))!);
    const flipped = (parseInt(env.data[10], 16) ^ 1).toString(16);
    env.data = env.data.slice(0, 10) + flipped + env.data.slice(11);
    await AsyncStorage.setItem(KEY, JSON.stringify(env));
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it.each([
    ["not JSON", "{{{"],
    ["wrong version", JSON.stringify({ v: 99, iv: "00", data: "00", mac: "00" })],
    ["missing fields", JSON.stringify({ v: 1 })],
    ["bad hex", JSON.stringify({ v: 1, iv: "zz", data: "zz", mac: "zz" })],
  ])("returns null for corrupt data (%s)", async (_label, blob) => {
    await largeSecureStore.setItem(KEY, "anything");
    await AsyncStorage.setItem(KEY, blob);
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it("returns null for a malformed key entry", async () => {
    await largeSecureStore.setItem(KEY, "anything");
    secureMap.set(`${KEY}.key`, "short");
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it("returns null when either half is missing", async () => {
    await largeSecureStore.setItem(KEY, "v");
    secureMap.delete(`${KEY}.key`);
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();

    await largeSecureStore.setItem(KEY, "v");
    await AsyncStorage.removeItem(KEY);
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it("returns null if the keychain throws", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keychain locked"));
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it("removeItem clears both stores", async () => {
    await largeSecureStore.setItem(KEY, bigSession(5000));
    await largeSecureStore.removeItem(KEY);
    expect(secureMap.has(`${KEY}.key`)).toBe(false);
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
    await expect(largeSecureStore.getItem(KEY)).resolves.toBeNull();
  });

  it("sanitises keys SecureStore can't accept", async () => {
    await largeSecureStore.setItem("odd key/with:chars", "v");
    expect([...secureMap.keys()]).toEqual(["odd_key_with_chars.key"]);
    await expect(largeSecureStore.getItem("odd key/with:chars")).resolves.toBe("v");
  });

  it("never logs", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => jest.spyOn(console, m));
    await largeSecureStore.setItem(KEY, bigSession(5000));
    secureMap.set(`${KEY}.key`, "ab".repeat(64));
    await largeSecureStore.getItem(KEY);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("hmacSha256", () => {
  it("matches the RFC 4231 test vector 2", async () => {
    // Key "Jefe" (padded to our 32-byte key size gives the same HMAC: HMAC
    // pads short keys with zeros to the block size anyway).
    const key = new Uint8Array(32);
    key.set(new TextEncoder().encode("Jefe"));
    const mac = await hmacSha256(key, new TextEncoder().encode("what do ya want for nothing?"));
    expect(Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
});
