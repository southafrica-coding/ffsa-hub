import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type MemoryStore } from "@/lib/missio/whatsapp/testing/memory-store";
import { inboundPayload, statusPayload, TEST_PHONE_NUMBER_ID } from "@/lib/missio/whatsapp/testing/payloads";
import { WhatsAppNotInstalledError } from "@/lib/missio/whatsapp/store";

// Fakes only: the store is in memory and no admin client reaches a DB.
const state = vi.hoisted(() => ({
  store: null as unknown,
  adminCreated: 0,
  scheduled: [] as Array<{ jobs: unknown[]; storedAtSchedule: number }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCreated += 1;
    return {};
  },
}));
vi.mock("@/lib/missio/whatsapp/supabase-store", () => ({ supabaseWhatsAppStore: () => state.store }));
// The menu bot only gets scheduled here (it runs after the response); record what was handed over.
vi.mock("@/lib/missio/whatsapp/bot/schedule", () => ({
  scheduleBotWork: (jobs: unknown[]) => {
    state.scheduled.push({ jobs, storedAtSchedule: (state.store as { messages: unknown[] }).messages.length });
  },
}));

import { GET, POST } from "./route";

const SECRET = "test-app-secret-not-real";
const URL_BASE = "https://hub.test/api/webhooks/missio/whatsapp";

function post(body: unknown, signature?: string | null) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signature === undefined ? `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` : signature;
  if (sig) headers["x-hub-signature-256"] = sig;
  return new Request(URL_BASE, { method: "POST", headers, body: raw });
}

let store: MemoryStore;
beforeEach(() => {
  store = memoryStore();
  state.store = store;
  state.adminCreated = 0;
  state.scheduled = [];
  vi.stubEnv("MISSIO_WHATSAPP_APP_SECRET", SECRET);
  vi.stubEnv("MISSIO_WHATSAPP_VERIFY_TOKEN", "verify-test-token");
  vi.stubEnv("MISSIO_WHATSAPP_PHONE_NUMBER_ID", TEST_PHONE_NUMBER_ID);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET handshake", () => {
  const get = (q: string) => GET(new Request(`${URL_BASE}?${q}`));

  it("echoes the challenge for the right token", async () => {
    const res = await get("hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=1158201444");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("refuses a wrong token with 403", async () => {
    const res = await get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("1");
  });

  it("answers 503 when no verify token is configured", async () => {
    vi.stubEnv("MISSIO_WHATSAPP_VERIFY_TOKEN", "");
    const res = await get("hub.mode=subscribe&hub.verify_token=&hub.challenge=1");
    expect(res.status).toBe(503);
  });
});

describe("POST", () => {
  it("stores a signed inbound message and answers 200", async () => {
    const res = await POST(post(inboundPayload({ wamid: "wamid.R1", text: "Hello from a test" })));
    expect(res.status).toBe(200);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]).toMatchObject({ wamid: "wamid.R1", body: "Hello from a test", direction: "in" });
  });

  it("is idempotent when Meta retries the same delivery", async () => {
    const payload = inboundPayload({ wamid: "wamid.R2" });
    await POST(post(payload));
    await POST(post(payload));
    expect(store.messages).toHaveLength(1);
    expect(store.threads[0].unread_count).toBe(1);
  });

  it("refuses a missing or wrong signature with 401 and writes nothing", async () => {
    expect((await POST(post(inboundPayload({ wamid: "wamid.R3" }), null))).status).toBe(401);
    expect((await POST(post(inboundPayload({ wamid: "wamid.R3" }), "sha256=" + "0".repeat(64)))).status).toBe(401);
    const raw = JSON.stringify(inboundPayload({ wamid: "wamid.R3" }));
    const good = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
    expect((await POST(post(raw.replace("Hello", "Hullo"), good))).status).toBe(401);
    expect(store.messages).toHaveLength(0);
    expect(state.adminCreated).toBe(0);
  });

  it("answers 503 when the app secret isn't configured", async () => {
    vi.stubEnv("MISSIO_WHATSAPP_APP_SECRET", "");
    expect((await POST(post(inboundPayload({ wamid: "wamid.R4" })))).status).toBe(503);
    expect(store.messages).toHaveLength(0);
  });

  it("answers 503 (so Meta retries) while migration 396 isn't applied", async () => {
    state.store = {
      ...store,
      missioOrgId: async () => "org-missio",
      matchContact: async () => null,
      ensureThread: async () => {
        throw new WhatsAppNotInstalledError();
      },
    };
    expect((await POST(post(inboundPayload({ wamid: "wamid.R5" })))).status).toBe(503);
  });

  it("refuses a signed body that isn't JSON", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
  });

  it("hands newly stored messages to the menu bot after the store, and still answers 200", async () => {
    const res = await POST(post(inboundPayload({ wamid: "wamid.B1", text: "Hi" })));
    expect(res.status).toBe(200);
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0].storedAtSchedule).toBe(1);
    expect(state.scheduled[0].jobs).toEqual([
      expect.objectContaining({ wamid: "wamid.B1", text: "Hi", kind: "text", replyId: null, optChange: null, wasOptedOut: false }),
    ]);
  });

  it("a retried delivery hands the bot nothing new", async () => {
    const payload = inboundPayload({ wamid: "wamid.B2" });
    await POST(post(payload));
    await POST(post(payload));
    expect(state.scheduled.map((s) => s.jobs.length)).toEqual([1, 0]);
  });

  it("passes the tapped reply id through, with the title as the readable body", async () => {
    await POST(post(inboundPayload({ wamid: "wamid.B3", reply: { kind: "list", id: "serve", title: "I want to serve" } })));
    expect(store.messages[0]).toMatchObject({ body: "I want to serve", wa_reply_id: "serve", wa_type: "interactive" });
    expect(state.scheduled[0].jobs[0]).toMatchObject({ replyId: "serve", text: "I want to serve" });
  });

  it("never schedules bot work before a verified signature", async () => {
    await POST(post(inboundPayload({ wamid: "wamid.B4" }), null));
    await POST(post(inboundPayload({ wamid: "wamid.B4" }), "sha256=" + "0".repeat(64)));
    expect(state.scheduled).toHaveLength(0);
  });

  it("applies signed status updates", async () => {
    const thread = await store.ensureThread({ orgId: "org-missio", e164: "+27820000001", waId: "27820000001", contactId: null, profileName: null });
    const row = await store.insertOutbound({ orgId: "org-missio", threadId: thread.id, kind: "text", body: "x", templateName: null, templateLanguage: null, templateVars: null, sentBy: "u1", at: "2026-11-23T12:00:00Z" });
    await store.acceptOutbound(row.id, "wamid.R6");
    await POST(post(statusPayload({ wamid: "wamid.R6", status: "read" })));
    await POST(post(statusPayload({ wamid: "wamid.R6", status: "delivered" })));
    expect(row.status).toBe("read");
  });
});
