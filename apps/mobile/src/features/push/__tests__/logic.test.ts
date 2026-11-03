import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError } from "@/lib/api";

import { isPushNotEnabled, pushPrefsSchema, registerDevice, unregisterDevice } from "../api";
import { PUSH_CHANNELS } from "../categories";
import {
  PRE_PROMPT_MIN_LAUNCHES,
  PRE_PROMPT_SNOOZE_MS,
  planSync,
  shouldOfferPrePrompt,
  targetForNotification,
  type SyncInput,
} from "../logic";
import { readPushState, setRegistration, updatePerson } from "../store";

const base: SyncInput = {
  supported: true,
  serverNotEnabled: false,
  enabled: true,
  permission: "granted",
  userId: "u1",
  appVersion: "1.0.0",
  token: "ExponentPushToken[aaa]",
  registered: null,
};
const reg = { token: "ExponentPushToken[aaa]", appVersion: "1.0.0", userId: "u1" };

describe("planSync (registration state machine)", () => {
  it.each<[string, Partial<SyncInput>, ReturnType<typeof planSync>]>([
    ["build can't do push", { supported: false }, { action: "none", status: "unsupported" }],
    ["server said not enabled this launch", { serverNotEnabled: true }, { action: "none", status: "not_enabled" }],
    ["never decided", { enabled: undefined }, { action: "none", status: "off" }],
    ["turned off, nothing registered", { enabled: false }, { action: "none", status: "off" }],
    ["turned off, registered → revoke", { enabled: false, registered: reg }, { action: "unregister", token: reg.token, status: "off" }],
    ["phone Settings say no", { permission: "denied" }, { action: "none", status: "blocked" }],
    ["phone Settings say no, registered → revoke", { permission: "denied", registered: reg }, { action: "unregister", token: reg.token, status: "blocked" }],
    ["on, not asked yet", { permission: "undetermined" }, { action: "none", status: "needs_permission" }],
    ["on, but no token (Expo Go, simulator)", { token: null }, { action: "none", status: "unsupported" }],
    ["on, first time → register", {}, { action: "register", token: "ExponentPushToken[aaa]" }],
    ["on, already registered → nothing", { registered: reg }, { action: "none", status: "on" }],
    ["token changed → register", { registered: { ...reg, token: "ExponentPushToken[old]" } }, { action: "register", token: "ExponentPushToken[aaa]" }],
    ["app updated → register", { registered: { ...reg, appVersion: "0.9.0" } }, { action: "register", token: "ExponentPushToken[aaa]" }],
    ["phone registered for someone else → register for me", { registered: { ...reg, userId: "u2" } }, { action: "register", token: "ExponentPushToken[aaa]" }],
    ["someone else's registration is never revoked with my session", { enabled: false, registered: { ...reg, userId: "u2" } }, { action: "none", status: "off" }],
  ])("%s", (_label, patch, expected) => {
    expect(planSync({ ...base, ...patch })).toEqual(expected);
  });
});

describe("shouldOfferPrePrompt", () => {
  const now = Date.parse("2026-11-03T10:00:00Z");
  const ok = {
    supported: true,
    serverNotEnabled: false,
    enabled: undefined,
    permission: "undetermined" as const,
    launches: PRE_PROMPT_MIN_LAUNCHES,
    dismissedAt: null,
    now,
  };

  it("offers on the third launch to someone who hasn't decided", () => {
    expect(shouldOfferPrePrompt(ok)).toBe(true);
  });

  it.each([
    ["never on the first launches", { launches: 1 }],
    ["not to someone who already decided (on)", { enabled: true }],
    ["not to someone who switched it off", { enabled: false }],
    ["not once the phone has answered", { permission: "denied" as const }],
    ["not when the build can't do push", { supported: false }],
    ["not when the server isn't ready", { serverNotEnabled: true }],
    ["not within a month of 'Not now'", { dismissedAt: now - PRE_PROMPT_SNOOZE_MS + 1000 }],
  ])("%s", (_label, patch) => {
    expect(shouldOfferPrePrompt({ ...ok, ...patch })).toBe(false);
  });

  it("asks again a month after 'Not now'", () => {
    expect(shouldOfferPrePrompt({ ...ok, dismissedAt: now - PRE_PROMPT_SNOOZE_MS })).toBe(true);
  });
});

describe("targetForNotification (Home's href → route table)", () => {
  it.each([
    [{ href: "/my-finance/team/1" }, { kind: "app", path: "/finance" }],
    [{ href: "/my-events" }, { kind: "app", path: "/tickets" }],
    [{ href: "/dashboard" }, { kind: "app", path: "/" }],
    [{ href: "/bookings/requests" }, { kind: "app", path: "/bookings/approvals" }],
    [{ href: "/bookings" }, { kind: "app", path: "/bookings" }],
    [{ href: "/admin/users" }, { kind: "web", path: "/admin/users" }],
    [{ href: "https://evil.example" }, { kind: "app", path: "/" }],
    [{ href: "//evil.example" }, { kind: "app", path: "/" }],
    [{ href: 42 }, { kind: "app", path: "/" }],
    [null, { kind: "app", path: "/" }],
    ["junk", { kind: "app", path: "/" }],
  ])("%j → %j", (data, expected) => {
    expect(targetForNotification(data)).toEqual(expected);
  });
});

describe("api helpers", () => {
  it("503 means 'not switched on yet'; other errors don't", () => {
    expect(isPushNotEnabled(new ApiError("http", "x", 503))).toBe(true);
    expect(isPushNotEnabled(new ApiError("http", "x", 500))).toBe(false);
    expect(isPushNotEnabled(new ApiError("network", "x"))).toBe(false);
    expect(isPushNotEnabled(new Error("x"))).toBe(false);
  });

  it("register and unregister call /api/devices", async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true });
    await registerDevice(fetch, { expoToken: "t", platform: "ios", appVersion: "1.0.0", deviceName: "iPhone 15" });
    await unregisterDevice(fetch, "t", { timeoutMs: 4000 });
    expect(fetch.mock.calls).toEqual([
      ["/api/devices", { method: "POST", body: { expoToken: "t", platform: "ios", appVersion: "1.0.0", deviceName: "iPhone 15" } }],
      ["/api/devices", { method: "DELETE", body: { expoToken: "t" }, timeoutMs: 4000 }],
    ]);
  });

  it("prefs parse tolerantly", () => {
    expect(pushPrefsSchema.parse({ categories: [{ key: "a", label: "A" }], muted: null, extra: 1 })).toEqual({
      categories: [{ key: "a", label: "A", description: "" }],
      muted: [],
    });
  });

  it("Android channel ids match the server's categories", () => {
    expect(PUSH_CHANNELS.map((c) => c.id)).toEqual(["booking_requests", "booking_updates"]);
  });
});

describe("local store", () => {
  beforeEach(() => AsyncStorage.clear());

  it("keeps each person's choice separately, and the registration", async () => {
    await updatePerson("u1", { enabled: true });
    await updatePerson("u2", { dismissedAt: 5 });
    await updatePerson("u1", { launches: 2 });
    await setRegistration({ token: "t", appVersion: "1", userId: "u1" });
    expect(await readPushState()).toEqual({
      people: { u1: { enabled: true, launches: 2 }, u2: { dismissedAt: 5 } },
      registration: { token: "t", appVersion: "1", userId: "u1" },
    });
  });

  it("corrupt storage reads as empty", async () => {
    await AsyncStorage.setItem("ffsa:push:v1", "{not json");
    expect(await readPushState()).toEqual({ people: {}, registration: null });
  });
});
