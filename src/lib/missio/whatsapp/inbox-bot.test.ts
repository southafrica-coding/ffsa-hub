import { describe, expect, it } from "vitest";
import { loadInbox, loadThread } from "./inbox";

// A fake pastor client: answers by table, and fails any select that asks
// for 397 columns while "397 isn't applied". No database.
function fakeClient(opts: { with397: boolean; threads: Array<Record<string, unknown>>; sessions?: unknown[]; interests?: unknown[]; messages?: unknown[] }) {
  const selects: string[] = [];
  const from = (table: string) => {
    let cols = "";
    const chain: Record<string, unknown> = {};
    for (const m of ["eq", "in", "order", "limit", "is"]) chain[m] = () => chain;
    chain.select = (c: string) => {
      cols = c;
      selects.push(`${table}: ${c}`);
      return chain;
    };
    const answer = () => {
      const wants397 = /bot_mode|sent_by_bot/.test(cols);
      if (wants397 && !opts.with397) return { data: null, error: { code: "42703", message: "column missio_whatsapp_threads.bot_mode does not exist" } };
      if (!opts.with397 && /bot_sessions|serving_interests/.test(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      if (table === "missio_whatsapp_threads") return { data: opts.threads, error: null };
      if (table === "missio_whatsapp_bot_sessions") return { data: opts.sessions ?? [], error: null };
      if (table === "missio_serving_interests") return { data: opts.interests ?? [], error: null };
      if (table === "missio_whatsapp_messages") return { data: opts.messages ?? [], error: null };
      return { data: [], error: null };
    };
    chain.maybeSingle = async () => {
      const a = answer();
      return { data: Array.isArray(a.data) ? (a.data[0] ?? null) : a.data, error: a.error };
    };
    chain.then = (resolve: (v: unknown) => void) => resolve(answer());
    return chain;
  };
  return { client: { from }, selects };
}

const thread = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  org_id: "org",
  contact_id: null,
  phone_e164: "+27820000001",
  wa_id: "27820000001",
  profile_name: "Sam",
  last_inbound_at: "2026-11-23T12:00:00Z",
  last_message_at: "2026-11-23T12:00:00Z",
  last_message_id: null,
  last_preview: "Hi",
  last_direction: "in",
  unread_count: 1,
  opted_out_at: null,
  ...over,
});

describe("inbox reads with the menu bot (397)", () => {
  it("before 397: falls back to the 396 columns and shows no bot", async () => {
    const { client, selects } = fakeClient({ with397: false, threads: [thread()] });
    const res = await loadInbox(client, "org", true);
    expect("threads" in res && res.threads[0]).toMatchObject({ id: "t1", bot: null, serving: 0 });
    expect(selects.filter((s) => s.startsWith("missio_whatsapp_threads"))).toHaveLength(2);
  });

  it("after 397: Bot while mid-flow, Serve for a new interest", async () => {
    const { client } = fakeClient({
      with397: true,
      threads: [thread(), thread({ id: "t2", bot_mode: "handed_off", bot_handoff_reason: "human" })].map((t) => ({ bot_mode: "on", bot_handoff_reason: null, ...t })),
      sessions: [{ thread_id: "t1", flow: "serve", step: "teams", updated_at: "2026-11-23T12:00:00Z" }],
      interests: [{ id: "i1", thread_id: "t2", teams: [{ id: null, name: "Kids" }], availability: "most_sundays", experience: "yes", note: null, status: "new", created_at: "2026-11-23T12:00:00Z" }],
    });
    const res = await loadInbox(client, "org", true);
    if (!("threads" in res)) throw new Error("expected an inbox");
    expect(res.threads[0]).toMatchObject({ bot: { mode: "on", active: true, flow: "serve" }, serving: 0 });
    expect(res.threads[1]).toMatchObject({ bot: { mode: "handed_off", reason: "human", active: false }, serving: 1 });
  });

  it("the open thread carries the status line and the serving answers in words", async () => {
    const { client } = fakeClient({
      with397: true,
      threads: [thread({ bot_mode: "on", bot_handoff_reason: null })],
      sessions: [{ thread_id: "t1", flow: "serve", step: "availability", updated_at: "2026-11-23T12:00:00Z" }],
      interests: [{ id: "i1", thread_id: "t1", teams: [{ id: "x", name: "Kids" }], availability: "monthly", experience: "a_little", note: "Mornings", status: "new", created_at: "2026-11-23T12:00:00Z" }],
      messages: [{ id: "m1", direction: "out", kind: "text", body: "How often could you help?", template_name: null, status: "read", error_code: null, error_title: null, opt_change: null, sent_at: "2026-11-23T12:00:00Z", sent_by_bot: true }],
    });
    const res = await loadThread(
      { supabase: client, orgId: "org", sendReady: true, loadPerson: async () => ({ status: 404 }), readPhone: async () => null, now: new Date("2026-11-23T12:05:00Z") },
      { threadId: "t1" }
    );
    if (!("messages" in res)) throw new Error("expected a thread");
    expect(res.bot).toMatchObject({ mode: "on", active: true, statusLine: "Bot is asking how often they could help" });
    expect(res.serving).toEqual([{ id: "i1", teams: ["Kids"], availability: "Once or twice a month", experience: "A little", note: "Mornings", status: "new", at: "2026-11-23T12:00:00Z" }]);
    expect(res.messages[0]).toMatchObject({ bot: true });
  });
});
