// /api/devices (register / revoke this phone) and /api/devices/preferences
// (push category opt-outs), the website's bearer-aware routes. Until the
// server's migration is applied they answer 503 {"error":"push_not_enabled"}.

import { z } from "zod";

import { ApiError, type ApiFetch, type ApiFetchInit } from "@/lib/api";

export type DeviceRegistration = {
  expoToken: string;
  platform: "ios" | "android";
  appVersion: string;
  deviceName?: string | null;
};

export function registerDevice(apiFetch: ApiFetch, body: DeviceRegistration) {
  return apiFetch("/api/devices", { method: "POST", body });
}

export function unregisterDevice(apiFetch: ApiFetch, expoToken: string, init?: Pick<ApiFetchInit, "timeoutMs">) {
  return apiFetch("/api/devices", { method: "DELETE", body: { expoToken }, ...init });
}

/** The server isn't ready for push yet (503 push_not_enabled). */
export function isPushNotEnabled(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

export const pushPrefsSchema = z.object({
  categories: z
    .array(z.object({ key: z.string(), label: z.string(), description: z.string().nullish().transform((v) => v ?? "") }))
    .nullish()
    .transform((v) => v ?? []),
  muted: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

export type PushPrefs = z.infer<typeof pushPrefsSchema>;

export function getPushPrefs(apiFetch: ApiFetch, init?: Pick<ApiFetchInit, "signal">) {
  return apiFetch("/api/devices/preferences", { ...init, schema: pushPrefsSchema });
}

export function savePushPrefs(apiFetch: ApiFetch, muted: string[]) {
  return apiFetch("/api/devices/preferences", { method: "PUT", body: { muted } });
}
