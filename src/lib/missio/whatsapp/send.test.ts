import { describe, expect, it } from "vitest";
import { listApprovedTemplates, messageBody } from "./graph";
import { templateView, type TemplateView } from "./rules";
import { sendFromHub, type SendDeps } from "./send";
import { memoryStore } from "./testing/memory-store";
import { inboundPayload, TEST_PHONE_NUMBER_ID } from "./testing/payloads";
import { handleWebhook } from "./webhook";

const NOW = new Date("2026-11-23T14:00:00.000Z");
const config = { accessToken: "test-token-not-real", phoneNumberId: TEST_PHONE_NUMBER_ID, wabaId: "300000000000003" };
const target = { e164: "+27820000001", contactId: "contact-1" };
const hello = templateView({
  name: "hello_name",
  language: "en",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hi {{1}}, it's Missio." }],
}) as TemplateView;

function fakeGraph(answer: { status?: number; json?: unknown } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.json ?? { messages: [{ id: `wamid.SENT${calls.length}` }] }), { status: answer.status ?? 200 });
  };
  return { calls, fetcher };
}

function deps(store = memoryStore(), graph = fakeGraph(), templates: TemplateView[] = [hello]): SendDeps & { graph: ReturnType<typeof fakeGraph> } {
  return { store, config, fetcher: graph.fetcher, loadTemplates: async () => ({ ok: true, templates }), now: () => NOW, graph };
}

const send = (d: SendDeps, content: Parameters<typeof sendFromHub>[1]["content"]) =>
  sendFromHub(d, { orgId: "org-missio", userId: "pastor-1", target, content });

async function wroteAt(store: ReturnType<typeof memoryStore>, iso: string, text = "Hi", wamid = `wamid.IN-${iso}`) {
  await handleWebhook(inboundPayload({ wamid, text, at: iso }), store, { phoneNumberId: TEST_PHONE_NUMBER_ID });
}

describe("sending: the 24-hour window", () => {
  it("sends free text inside the window and stores the wamid", async () => {
    const d = deps();
    await wroteAt(d.store as ReturnType<typeof memoryStore>, "2026-11-23T13:00:00Z");
    const res = await send(d, { kind: "text", text: " See you Sunday " });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message).toMatchObject({ direction: "out", kind: "text", body: "See you Sunday", status: "accepted", wamid: "wamid.SENT1", sent_by: "pastor-1" });
    expect(d.graph.calls).toHaveLength(1);
    expect(d.graph.calls[0].url).toBe(`https://graph.facebook.com/v23.0/${TEST_PHONE_NUMBER_ID}/messages`);
    expect(JSON.parse(String(d.graph.calls[0].init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+27820000001",
      type: "text",
      text: { preview_url: false, body: "See you Sunday" },
    });
  });

  it("refuses free text outside the window, without calling WhatsApp or writing", async () => {
    const d = deps();
    const store = d.store as ReturnType<typeof memoryStore>;
    await wroteAt(store, "2026-11-22T13:59:00Z");
    const res = await send(d, { kind: "text", text: "Hi" });
    expect(res).toMatchObject({ ok: false, status: 409, code: "template_required" });
    expect(d.graph.calls).toHaveLength(0);
    expect(store.messages.filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("our own earlier messages don't open the window", async () => {
    const d = deps();
    const first = await send(d, { kind: "template", name: "hello_name", language: "en", values: { "body:1": "Kea" } });
    expect(first.ok).toBe(true);
    const res = await send(d, { kind: "text", text: "Following up" });
    expect(res).toMatchObject({ ok: false, code: "template_required" });
  });

  it("sends an approved template outside the window, blanks filled", async () => {
    const d = deps();
    const res = await send(d, { kind: "template", name: "hello_name", language: "en", values: { "body:1": "Kea" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message).toMatchObject({ kind: "template", body: "Hi Kea, it's Missio.", template_name: "hello_name", template_vars: { "body:1": "Kea" } });
    expect(JSON.parse(String(d.graph.calls[0].init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+27820000001",
      type: "template",
      template: { name: "hello_name", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Kea" }] }] },
    });
  });

  it("refuses a template that isn't approved, or with a blank left empty", async () => {
    const d = deps();
    expect(await send(d, { kind: "template", name: "made_up", language: "en", values: {} })).toMatchObject({ ok: false, code: "template_unavailable" });
    expect(await send(d, { kind: "template", name: "hello_name", language: "en", values: {} })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(d.graph.calls).toHaveLength(0);
  });

  it("with no approved templates (today's live state) nothing can start a conversation", async () => {
    const d = deps(memoryStore(), fakeGraph(), []);
    expect(await send(d, { kind: "template", name: "hello_name", language: "en", values: { "body:1": "Kea" } })).toMatchObject({
      ok: false,
      code: "template_unavailable",
    });
    expect(await send(d, { kind: "text", text: "Hi" })).toMatchObject({ ok: false, code: "template_required" });
    expect(d.graph.calls).toHaveLength(0);
  });
});

describe("sending: opt-out", () => {
  it("STOP blocks every send with no call to WhatsApp; START lets them through again", async () => {
    const d = deps();
    const store = d.store as ReturnType<typeof memoryStore>;
    await wroteAt(store, "2026-11-23T13:00:00Z", "STOP", "wamid.STOP");
    expect(await send(d, { kind: "text", text: "Hi" })).toMatchObject({ ok: false, status: 409, code: "opted_out" });
    expect(await send(d, { kind: "template", name: "hello_name", language: "en", values: { "body:1": "Kea" } })).toMatchObject({ code: "opted_out" });
    expect(d.graph.calls).toHaveLength(0);

    await wroteAt(store, "2026-11-23T13:30:00Z", "start", "wamid.START");
    expect((await send(d, { kind: "text", text: "Welcome back" })).ok).toBe(true);
    expect(d.graph.calls).toHaveLength(1);
  });
});

describe("sending: failures", () => {
  it("answers 503 not_configured with no settings, before touching anything", async () => {
    const d = { ...deps(), config: null };
    expect(await send(d, { kind: "text", text: "Hi" })).toMatchObject({ ok: false, status: 503, code: "not_configured" });
    expect((d.store as ReturnType<typeof memoryStore>).threads).toHaveLength(0);
  });

  it("keeps a message WhatsApp refused, marked failed with the reason", async () => {
    const graph = fakeGraph({ status: 400, json: { error: { code: 131030, message: "Recipient phone number not in allowed list", error_user_title: "Number not allowed" } } });
    const d = deps(memoryStore(), graph);
    const res = await send(d, { kind: "template", name: "hello_name", language: "en", values: { "body:1": "Kea" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message).toMatchObject({ status: "failed", error_code: 131030, error_title: "Number not allowed", wamid: null });
  });

  it("never puts the token in the payload or in an error", async () => {
    const graph = fakeGraph({ status: 500, json: null });
    const d = deps(memoryStore(), graph);
    const res = await send(d, { kind: "template", name: "hello_name", language: "en", values: { "body:1": "Kea" } });
    expect(JSON.stringify(res)).not.toContain(config.accessToken);
    expect(String(graph.calls[0].init?.body)).not.toContain(config.accessToken);
    expect((graph.calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.accessToken}`);
  });
});

describe("graph helpers", () => {
  it("the text payload sends E.164 with the plus", () => {
    expect(messageBody({ kind: "text", to: "+27823607000", body: "x" })).toMatchObject({ to: "+27823607000", type: "text" });
  });

  it("lists approved templates only, and an empty WABA honestly", async () => {
    const pages = [
      { data: [{ name: "b", language: "en", status: "APPROVED", components: [{ type: "BODY", text: "B" }] }, { name: "a", language: "en", status: "PENDING", components: [{ type: "BODY", text: "A" }] }] },
    ];
    const fetcher = async () => new Response(JSON.stringify(pages[0]));
    const out = await listApprovedTemplates(config, fetcher);
    expect(out.ok && out.templates.map((t) => t.name)).toEqual(["b"]);
    const empty = await listApprovedTemplates(config, async () => new Response(JSON.stringify({ data: [] })));
    expect(empty).toEqual({ ok: true, templates: [] });
  });

  it("doesn't follow a paging link off Graph", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [], paging: { next: "https://evil.example/next" } }));
    };
    await listApprovedTemplates(config, fetcher);
    expect(calls).toBe(1);
  });
});
