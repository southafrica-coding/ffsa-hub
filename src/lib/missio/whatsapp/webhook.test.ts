import { describe, expect, it } from "vitest";
import { memoryStore } from "./testing/memory-store";
import { inboundPayload, statusPayload, TEST_PHONE_NUMBER_ID } from "./testing/payloads";
import { handleWebhook } from "./webhook";

const opts = { phoneNumberId: TEST_PHONE_NUMBER_ID, now: new Date("2026-11-23T12:01:00Z") };

async function outbound(store: ReturnType<typeof memoryStore>, wamid: string | null) {
  const thread = await store.ensureThread({ orgId: "org-missio", e164: "+27820000001", waId: "27820000001", contactId: null, profileName: null });
  const row = await store.insertOutbound({
    orgId: "org-missio",
    threadId: thread.id,
    kind: "text",
    body: "Hi",
    templateName: null,
    templateLanguage: null,
    templateVars: null,
    sentBy: "u1",
    at: "2026-11-23T12:00:00Z",
  });
  if (wamid) await store.acceptOutbound(row.id, wamid);
  return row;
}

describe("webhook: inbound messages", () => {
  it("stores an inbound message once, even when Meta delivers it twice", async () => {
    const store = memoryStore();
    const payload = inboundPayload({ wamid: "wamid.IN1", text: "Hi pastor" });
    expect(await handleWebhook(payload, store, opts)).toMatchObject({ inbound: 1, duplicates: 0 });
    expect(await handleWebhook(payload, store, opts)).toMatchObject({ inbound: 0, duplicates: 1 });
    expect(store.messages).toHaveLength(1);
    expect(store.threads).toHaveLength(1);
    expect(store.threads[0]).toMatchObject({ unread_count: 1, phone_e164: "+27820000001", last_preview: "Hi pastor", last_direction: "in" });
    expect(store.threads[0].last_inbound_at).toBe("2026-11-23T12:00:00.000Z");
  });

  it("keeps a number that isn't in People, so the reply isn't lost", async () => {
    const store = memoryStore();
    await handleWebhook(inboundPayload({ wamid: "wamid.IN2", name: "Unknown Caller" }), store, opts);
    expect(store.threads[0]).toMatchObject({ contact_id: null, profile_name: "Unknown Caller" });
    expect(store.messages[0]).toMatchObject({ direction: "in", body: "Hello" });
  });

  it("links the thread when exactly one Missio person has the number", async () => {
    const store = memoryStore();
    store.contacts.set("+27820000001", "contact-1");
    await handleWebhook(inboundPayload({ wamid: "wamid.IN3" }), store, opts);
    expect(store.threads[0].contact_id).toBe("contact-1");
  });

  it("stores a photo as a placeholder instead of dropping it", async () => {
    const store = memoryStore();
    await handleWebhook(inboundPayload({ wamid: "wamid.IMG", type: "image" }), store, opts);
    expect(store.messages[0]).toMatchObject({ kind: "placeholder", body: "[Photo]", wa_type: "image" });
  });

  it("ignores messages for another number on the same app", async () => {
    const store = memoryStore();
    const out = await handleWebhook(inboundPayload({ wamid: "wamid.OTHER", phoneNumberId: "999" }), store, opts);
    expect(out.ignored).toBe(1);
    expect(store.messages).toHaveLength(0);
  });

  it("ignores payloads that aren't WhatsApp business ones", async () => {
    const store = memoryStore();
    await handleWebhook({ ...inboundPayload({ wamid: "wamid.X" }), object: "page" }, store, opts);
    expect(store.messages).toHaveLength(0);
  });
});

describe("webhook: STOP and START", () => {
  it("STOP opts them out and leaves a note in the thread; START clears it", async () => {
    const store = memoryStore();
    await handleWebhook(inboundPayload({ wamid: "wamid.S1", text: "Stop.", at: "2026-11-23T10:00:00Z" }), store, opts);
    expect(store.threads[0].opted_out_at).toBe("2026-11-23T10:00:00.000Z");
    expect(store.messages[0].opt_change).toBe("opt_out");

    await handleWebhook(inboundPayload({ wamid: "wamid.S2", text: "START", at: "2026-11-23T11:00:00Z" }), store, opts);
    expect(store.threads[0].opted_out_at).toBeNull();
    expect(store.messages[1].opt_change).toBe("opt_in");
  });

  it("an old STOP delivered late doesn't undo a newer START", async () => {
    const store = memoryStore();
    await handleWebhook(inboundPayload({ wamid: "wamid.S3", text: "START", at: "2026-11-23T11:00:00Z" }), store, opts);
    await handleWebhook(inboundPayload({ wamid: "wamid.S4", text: "STOP", at: "2026-11-23T10:00:00Z" }), store, opts);
    expect(store.threads[0].opted_out_at).toBeNull();
  });
});

describe("webhook: statuses", () => {
  it("moves an outbound message forward: sent → delivered → read", async () => {
    const store = memoryStore();
    const row = await outbound(store, "wamid.OUT1");
    await handleWebhook(statusPayload({ wamid: "wamid.OUT1", status: "sent" }), store, opts);
    expect(row.status).toBe("sent");
    await handleWebhook(statusPayload({ wamid: "wamid.OUT1", status: "delivered" }), store, opts);
    await handleWebhook(statusPayload({ wamid: "wamid.OUT1", status: "read" }), store, opts);
    expect(row.status).toBe("read");
  });

  it("never moves backwards when statuses arrive out of order", async () => {
    const store = memoryStore();
    const row = await outbound(store, "wamid.OUT2");
    await handleWebhook(statusPayload({ wamid: "wamid.OUT2", status: "read" }), store, opts);
    await handleWebhook(statusPayload({ wamid: "wamid.OUT2", status: "delivered" }), store, opts);
    await handleWebhook(statusPayload({ wamid: "wamid.OUT2", status: "sent" }), store, opts);
    expect(row.status).toBe("read");
  });

  it("records failed with WhatsApp's reason", async () => {
    const store = memoryStore();
    const row = await outbound(store, "wamid.OUT3");
    await handleWebhook(statusPayload({ wamid: "wamid.OUT3", status: "failed", error: { code: 131047, title: "Re-engagement message" } }), store, opts);
    expect(row).toMatchObject({ status: "failed", error_code: 131047, error_title: "Re-engagement message" });
    await handleWebhook(statusPayload({ wamid: "wamid.OUT3", status: "delivered" }), store, opts);
    expect(row.status).toBe("failed");
  });

  it("a status that arrives before its message is applied once the send finishes", async () => {
    const store = memoryStore();
    const row = await outbound(store, null);
    await handleWebhook(statusPayload({ wamid: "wamid.EARLY", status: "delivered" }), store, opts);
    await handleWebhook(statusPayload({ wamid: "wamid.EARLY", status: "delivered" }), store, opts);
    expect(store.statusEvents).toHaveLength(1);
    expect(row.status).toBe("pending");
    await store.acceptOutbound(row.id, "wamid.EARLY");
    expect(row.status).toBe("delivered");
  });

  it("a duplicate status is stored once and changes nothing", async () => {
    const store = memoryStore();
    const row = await outbound(store, "wamid.OUT4");
    await handleWebhook(statusPayload({ wamid: "wamid.OUT4", status: "delivered" }), store, opts);
    await handleWebhook(statusPayload({ wamid: "wamid.OUT4", status: "delivered" }), store, opts);
    expect(store.statusEvents).toHaveLength(1);
    expect(row.status).toBe("delivered");
  });

  it("ignores statuses it doesn't store", async () => {
    const store = memoryStore();
    const out = await handleWebhook(statusPayload({ wamid: "wamid.OUT5", status: "deleted" }), store, opts);
    expect(out.ignored).toBe(1);
    expect(store.statusEvents).toHaveLength(0);
  });
});
