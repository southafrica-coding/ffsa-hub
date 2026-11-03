import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme } from "nativewind";

import {
  applyPreference,
  isPreference,
  readPreference,
  resolveScheme,
  STORAGE_KEY,
  writePreference,
} from "../preference";

jest.mock("nativewind", () => ({ ...jest.requireActual("nativewind"), colorScheme: { set: jest.fn() } }));

const set = colorScheme.set as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  set.mockReset();
});

describe("isPreference", () => {
  it.each(["system", "light", "dark"])("accepts %s", (v) => expect(isPreference(v)).toBe(true));
  it.each(["", "auto", "DARK", null, undefined, 1])("rejects %p", (v) => expect(isPreference(v)).toBe(false));
});

describe("resolveScheme", () => {
  it("a fixed choice wins over the phone", () => {
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });
  it("match phone follows the phone, light when unknown", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", undefined)).toBe("light");
  });
});

describe("storage (this phone only)", () => {
  it("defaults to match phone when nothing is saved", async () => {
    expect(await readPreference()).toBe("system");
  });

  it("round-trips a choice under one fixed, non-personal key", async () => {
    await writePreference("dark");
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(STORAGE_KEY).not.toMatch(/user|[0-9a-f]{8}-/i);
    expect(await readPreference()).toBe("dark");
  });

  it("treats garbage as the default, never a crash", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "purple");
    expect(await readPreference()).toBe("system");
  });

  it("treats an unreadable store as the default", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    expect(await readPreference()).toBe("system");
  });

  it("lets a failed save reach the caller", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await expect(writePreference("light")).rejects.toThrow("full");
  });
});

describe("applyPreference: one mechanism (NativeWind -> RN Appearance)", () => {
  it.each(["system", "light", "dark"] as const)("passes %s to NativeWind's colorScheme.set", (pref) => {
    applyPreference(pref);
    expect(set).toHaveBeenCalledWith(pref);
  });

  it("never throws if the native module is missing", () => {
    set.mockImplementationOnce(() => {
      throw new Error("no Appearance");
    });
    expect(() => applyPreference("dark")).not.toThrow();
  });
});
