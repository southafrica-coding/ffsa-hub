// ────────────────────────────────────────────────────────────
// Phone push sender (Expo push service → APNs / FCM)
// ────────────────────────────────────────────────────────────
// sendPush(userIds, { kind, key, href }) tells those people's phones that
// something is waiting. It:
//   - drops deactivated users and anyone who switched that category off,
//   - sends the generic text for the kind (categories.ts), never details,
//   - batches at most 100 messages per request (Expo's limit),
//   - revokes tokens Expo reports as DeviceNotRegistered (app uninstalled),
//   - NEVER throws. A push is a courtesy on top of the real action; a push
//     outage must not fail or slow the request that triggered it. Call it
//     from after() (see notify.ts).
//
// Until migration 288 is applied the token table doesn't exist and this is
// a silent no-op ({ skipped: "not_enabled" }).
//
// EXPO_ACCESS_TOKEN (optional, server only) is sent as a bearer token if set,
// for when "enhanced push security" is switched on for the Expo project.
// ────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { categoryFor, pushText, type PushKind } from "./categories";
import { isMissingSchema } from "./schema-errors";
import {
  getActiveUserIds,
  getLiveDevices,
  getPushMutesFor,
  revokeTokens,
  type DeviceRow,
} from "./store";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 8_000;

export type PushInput = {
  kind: PushKind;
  /** Stable feed key, e.g. "booking:<uuid>", so the app can match the item. */
  key: string;
  /** Website path the tap opens, e.g. "/bookings/requests". */
  href: string;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { href: string; kind: PushKind; key: string };
  channelId: string;
  priority: "default";
};

export type PushResult = {
  skipped?: "no_recipients" | "not_enabled" | "not_configured" | "error";
  sent: number;
  failed: number;
  revoked: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Deps = {
  admin?: Client;
  fetchImpl?: typeof fetch;
};

// ── Pure helpers (unit-tested) ───────────────────────────────

export function chunk<T>(items: T[], size: number = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Users left after removing those who muted the kind's category. */
export function filterOptedOut(
  userIds: string[],
  kind: PushKind,
  mutes: { user_id: string; push_muted_kinds: string[] | null }[]
): string[] {
  const category = categoryFor(kind);
  const muted = new Set(
    mutes.filter((m) => (m.push_muted_kinds ?? []).includes(category)).map((m) => m.user_id)
  );
  return userIds.filter((id) => !muted.has(id));
}

/** One message per phone. Text comes from the kind, never the caller. */
export function buildMessages(devices: Pick<DeviceRow, "expo_token">[], input: PushInput): ExpoMessage[] {
  const { title, body } = pushText(input.kind);
  return devices.map((d) => ({
    to: d.expo_token,
    title,
    body,
    data: { href: input.href, kind: input.kind, key: input.key },
    // Android: one channel per category (the app creates them). No sound
    // field: quiet by default; the channel decides on Android.
    channelId: categoryFor(input.kind),
    priority: "default",
  }));
}

type Ticket = { status?: string; details?: { error?: string } };

/** Tokens whose ticket says the phone is gone. Tickets come back in order. */
export function unregisteredTokens(messages: ExpoMessage[], tickets: Ticket[]): string[] {
  const out: string[] = [];
  tickets.forEach((t, i) => {
    if (t?.status === "error" && t.details?.error === "DeviceNotRegistered" && messages[i]) {
      out.push(messages[i].to);
    }
  });
  return out;
}

// ── Sender ───────────────────────────────────────────────────

async function postBatch(
  fetchImpl: typeof fetch,
  batch: ExpoMessage[]
): Promise<{ tickets: Ticket[] } | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[push] Expo push service answered", res.status);
      return null;
    }
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    return { tickets: Array.isArray(json?.data) ? (json!.data as Ticket[]) : [] };
  } catch (err) {
    console.warn("[push] Expo push request failed", err instanceof Error ? err.name : "error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendPush(
  userIds: string[],
  input: PushInput,
  deps: Deps = {}
): Promise<PushResult> {
  const none = { sent: 0, failed: 0, revoked: 0 };
  try {
    const unique = Array.from(new Set(userIds.filter((id) => typeof id === "string" && id)));
    if (unique.length === 0) return { skipped: "no_recipients", ...none };

    let admin = deps.admin;
    if (!admin) {
      try {
        admin = createAdminClient();
      } catch {
        return { skipped: "not_configured", ...none };
      }
    }

    // Live phones first: if the table isn't there yet, stop before anything else.
    const devicesRes = await getLiveDevices(admin, unique);
    if (devicesRes.error) {
      if (isMissingSchema(devicesRes.error)) return { skipped: "not_enabled", ...none };
      console.warn("[push] couldn't read devices", devicesRes.error.code ?? "");
      return { skipped: "error", ...none };
    }
    const devices = (devicesRes.data ?? []) as DeviceRow[];
    if (devices.length === 0) return { skipped: "no_recipients", ...none };

    const withPhones = Array.from(new Set(devices.map((d) => d.user_id)));
    const [activeRes, mutesRes] = await Promise.all([
      getActiveUserIds(admin, withPhones),
      getPushMutesFor(admin, withPhones),
    ]);
    if (activeRes.error) {
      console.warn("[push] couldn't read users", activeRes.error.code ?? "");
      return { skipped: "error", ...none };
    }
    const active = new Set(((activeRes.data ?? []) as { id: string }[]).map((u) => u.id));
    // A missing opt-out column (half-applied migration) means nobody opted out.
    const mutes = mutesRes.error ? [] : (mutesRes.data ?? []);
    if (mutesRes.error && !isMissingSchema(mutesRes.error)) {
      // Can't tell who opted out: don't risk pushing to someone who said no.
      console.warn("[push] couldn't read push opt-outs", mutesRes.error.code ?? "");
      return { skipped: "error", ...none };
    }
    const allowed = new Set(filterOptedOut(withPhones.filter((id) => active.has(id)), input.kind, mutes));
    const targets = devices.filter((d) => allowed.has(d.user_id));
    if (targets.length === 0) return { skipped: "no_recipients", ...none };

    const fetchImpl = deps.fetchImpl ?? fetch;
    const result = { ...none };
    const gone: string[] = [];
    for (const batch of chunk(buildMessages(targets, input))) {
      const res = await postBatch(fetchImpl, batch);
      if (!res) {
        result.failed += batch.length;
        continue;
      }
      batch.forEach((_, i) => {
        if (res.tickets[i]?.status === "ok") result.sent += 1;
        else result.failed += 1;
      });
      gone.push(...unregisteredTokens(batch, res.tickets));
    }

    if (gone.length > 0) {
      const { error } = await revokeTokens(admin, gone);
      if (!error) result.revoked = gone.length;
    }
    return result;
  } catch (err) {
    console.warn("[push] send failed", err instanceof Error ? err.name : "error");
    return { skipped: "error", ...none };
  }
}
