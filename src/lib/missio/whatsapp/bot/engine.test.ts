import { describe, expect, it, vi } from "vitest";
import { memoryStore, type MemoryStore } from "../testing/memory-store";
import { inboundPayload, TEST_PHONE_NUMBER_ID } from "../testing/payloads";
import { handleWebhook } from "../webhook";
import {
  AVAILABILITY,
  FALLBACK,
  FALLBACK_TEAMS,
  HANDOFF_DEFERRED,
  HANDOFF_HUMAN,
  MAIN_MENU,
  SERVE_CLOSE,
  SERVE_TEAMS,
  WELCOME,
} from "./copy";
import { FALLBACK_TEAM_LIST, processBotJob, type BotDeps } from "./engine";
import { createLimiter } from "./limiter";
import { runBotJobs } from "./schedule";
import type { BotJob } from "./types";

// Fakes only: the store is in memory and Graph is a mocked fetch. No Meta,
// no database, no real numbers. The config values are made up.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const CONFIG = { accessToken: "test-token-not-real", phoneNumberId: TEST_PHONE_NUMBER_ID, wabaId: "300000000000003" };
const START = Date.parse("2026-11-23T12:00:00Z");

type Sent = { to: string; type: string; text?: { body: string }; interactive?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

function harness(opts: { teams?: Array<{ id: string; name: string }>; teamsError?: boolean; config?: typeof CONFIG | null } = {}) {
  const store: MemoryStore = memoryStore();
  store.teams = opts.teams ?? [];
  store.teamsError = Boolean(opts.teamsError);
  let clock = START;
  let n = 0;
  const sent: Sent[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${sent.length}` }] }), { status: 200 });
  });
  const deps: BotDeps = {
    store,
    config: opts.config === undefined ? CONFIG : opts.config,
    limiter: createLimiter(2),
    notify: { loadTemplates: async () => ({ ok: true, templates: [] }), leadersFor: async () => [] },
    fetcher,
    now: () => new Date(clock),
  };

  /** One message from them through the real webhook handler, then the bot. */
  async function say(input: string | { id: string; title: string; kind?: "list" | "button" }, extra: { wamid?: string; at?: number; run?: boolean } = {}) {
    n += 1;
    const at = extra.at ?? START + n * 10_000;
    clock = Math.max(clock, at + 1_000);
    const wamid = extra.wamid ?? `wamid.IN${n}`;
    const payload =
      typeof input === "string"
        ? inboundPayload({ wamid, text: input, at: new Date(at).toISOString(), name: "Sam Example" })
        : inboundPayload({ wamid, reply: { kind: input.kind ?? "list", id: input.id, title: input.title }, at: new Date(at).toISOString(), name: "Sam Example" });
    const outcome = await handleWebhook(payload, store, { phoneNumberId: TEST_PHONE_NUMBER_ID, now: new Date(clock) });
    const before = sent.length;
    const results = [];
    if (extra.run !== false) for (const job of outcome.jobs) results.push(await processBotJob(deps, job));
    return { outcome, results, replies: sent.slice(before) };
  }

  return {
    store,
    deps,
    sent,
    fetcher,
    say,
    advance(ms: number) {
      clock += ms;
    },
    thread() {
      return store.threads[0];
    },
  };
}

const bodyOf = (m: Sent) => m.text?.body ?? m.interactive?.body?.text;
const rowIds = (m: Sent) => (m.interactive?.action?.sections?.[0]?.rows ?? []).map((r: { id: string }) => r.id);
const rowTitles = (m: Sent) => (m.interactive?.action?.sections?.[0]?.rows ?? []).map((r: { title: string }) => r.title);
const buttonIds = (m: Sent) => (m.interactive?.action?.buttons ?? []).map((b: { reply: { id: string } }) => b.reply.id);

describe("welcome", () => {
  it("answers a first message with the welcome and the main list, inside the window", async () => {
    const h = harness();
    const { replies } = await h.say("Hello");
    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe("interactive");
    expect(replies[0].interactive?.type).toBe("list");
    expect(bodyOf(replies[0])).toBe(WELCOME);
    expect(replies[0].interactive?.action?.button).toBe("Choose");
    expect(rowIds(replies[0])).toEqual(MAIN_MENU.map((r) => r.id));
    expect(replies[0].to).toBe("+27820000001");
    // Stored in the thread as the menu's message, not a pastor's.
    const out = h.store.messages.filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sent_by: null, sent_by_bot: true, wa_type: "interactive", status: "accepted", wamid: "wamid.OUT1" });
    expect(out[0].body).toContain("Choices: I’m new here · Find a house church");
    expect(h.store.sessions[0]).toMatchObject({ flow: "menu", step: "main", closed_at: null });
  });

  it("never puts the access token anywhere but the Authorization header", async () => {
    const h = harness();
    await h.say("Hello");
    const init = h.fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token-not-real");
    expect(String(init.body)).not.toContain("test-token-not-real");
    expect(JSON.stringify(h.store.outbox)).not.toContain("test-token-not-real");
    expect(JSON.stringify(h.store.messages)).not.toContain("test-token-not-real");
  });

  it("sends nothing at all when WhatsApp isn't configured", async () => {
    const h = harness({ config: null });
    const { results } = await h.say("Hello");
    expect(results[0].outcome).toBe("not_configured");
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.store.outbox).toHaveLength(0);
  });
});

describe("routing on reply ids", () => {
  it("routes on the tapped id, even when the title says something else", async () => {
    const h = harness();
    await h.say("Hi");
    const { replies } = await h.say({ id: "serve", title: "Something renamed" });
    expect(bodyOf(replies[0])).toBe(SERVE_TEAMS);
    // The reply id is stored on the inbound row; the title stays the body.
    const tapped = h.store.messages.find((m) => m.wa_reply_id === "serve");
    expect(tapped).toMatchObject({ body: "Something renamed", wa_type: "interactive" });
  });

  it("also takes the exact words of a row", async () => {
    const h = harness();
    await h.say("Hi");
    const { replies } = await h.say("I want to serve.");
    expect(bodyOf(replies[0])).toBe(SERVE_TEAMS);
  });
});

describe("serving", () => {
  const TEAMS = [
    { id: "00000000-0000-4000-8000-0000000000b1", name: "Welcome" },
    { id: "00000000-0000-4000-8000-0000000000b2", name: "Kids" },
  ];

  it("happy path: teams → how often → experience → thank-you → note → one interest, no person created", async () => {
    const h = harness({ teams: TEAMS });
    h.store.contactNames.set("contact-1", "Sam");
    h.store.contacts.set("+27820000001", "contact-1");
    await h.say("Hi");
    let r = await h.say({ id: "serve", title: "I want to serve" });
    // Live teams, alphabetical, plus Other.
    expect(rowTitles(r.replies[0])).toEqual(["Kids", "Welcome", "Other"]);

    r = await h.say({ id: `team:${TEAMS[1].id}`, title: "Kids" });
    expect(bodyOf(r.replies[0])).toBe("Added Kids. Pick another team, or tap Done.");
    expect(buttonIds(r.replies[0])).toEqual(["serve:more", "serve:done"]);

    r = await h.say({ id: "serve:more", title: "Add another", kind: "button" });
    // Kids is already picked, so it isn't offered again.
    expect(rowTitles(r.replies[0])).toEqual(["Welcome", "Other"]);

    r = await h.say({ id: "team:other", title: "Other" });
    expect(bodyOf(r.replies[0])).toBe("Which team would you like to serve on? Type its name.");
    r = await h.say("Coffee bar");
    expect(bodyOf(r.replies[0])).toBe("Added Coffee bar. Pick another team, or tap Done.");

    r = await h.say({ id: "serve:done", title: "Done", kind: "button" });
    expect(bodyOf(r.replies[0])).toBe("How often could you help?");
    expect(rowTitles(r.replies[0])).toEqual(AVAILABILITY.map((a) => a.title));

    r = await h.say({ id: "avail:monthly", title: "Once or twice a month" });
    expect(bodyOf(r.replies[0])).toBe("Have you served on a church team before?");
    expect(buttonIds(r.replies[0])).toEqual(["exp:yes", "exp:a_little", "exp:not_yet"]);

    expect(h.store.interests).toHaveLength(0);
    r = await h.say({ id: "exp:a_little", title: "A little", kind: "button" });
    expect(bodyOf(r.replies[0])).toBe(
      "Thank you, Sam. We’ve noted your interest in Kids and Coffee bar and let the team leader know. They’ll follow up.\n\n" +
        "If you want to add a note — experience, times that work, anything else — send it now, or tap Done."
    );
    expect(buttonIds(r.replies[0])).toEqual(["serve:note_done"]);
    expect(h.store.interests).toHaveLength(1);
    expect(h.store.interests[0]).toMatchObject({
      contactId: "contact-1",
      threadId: h.thread().id,
      teams: [
        { id: TEAMS[1].id, name: "Kids" },
        { id: null, name: "Coffee bar" },
      ],
      availability: "monthly",
      experience: "a_little",
      note: null,
      status: "new",
    });

    r = await h.say("I play guitar and can do mornings");
    expect(bodyOf(r.replies[0])).toBe(SERVE_CLOSE);
    expect(h.store.interests).toHaveLength(1);
    expect(h.store.interests[0].note).toBe("I play guitar and can do mornings");

    // Resting: a "thanks" afterwards gets nothing; "menu" brings the welcome back.
    r = await h.say("Thanks!");
    expect(r.replies).toHaveLength(0);
    r = await h.say("menu");
    expect(bodyOf(r.replies[0])).toBe(WELCOME);
    expect(h.store.interests).toHaveLength(1);
  });

  it("leaves contact_id empty when the number isn't one Missio person (and never makes one)", async () => {
    const h = harness({ teams: TEAMS });
    await h.say("I want to serve");
    await h.say({ id: `team:${TEAMS[0].id}`, title: "Welcome" });
    await h.say("Done");
    await h.say("Most Sundays");
    await h.say("Not yet");
    expect(h.store.interests).toHaveLength(1);
    expect(h.store.interests[0].contactId).toBeNull();
    expect(h.thread().contact_id).toBeNull();
    // The WhatsApp name is used only when it looks like a first name.
    expect(h.sent.at(-1)?.interactive?.body?.text).toMatch(/^Thank you, Sam\./);
    // Tapping Done skips the note.
    const r = await h.say({ id: "serve:note_done", title: "Done", kind: "button" });
    expect(bodyOf(r.replies[0])).toBe(SERVE_CLOSE);
    expect(h.store.interests[0].note).toBeNull();
  });

  it("uses the fallback team list when missio_teams is empty", async () => {
    const h = harness({ teams: [] });
    const { replies } = await h.say({ id: "serve", title: "I want to serve" });
    expect(rowTitles(replies[0])).toEqual([...FALLBACK_TEAMS.map((t) => t.name), "Other"]);
    expect(rowIds(replies[0])).toEqual([...FALLBACK_TEAM_LIST.map((t) => `team:${t.id}`), "team:other"]);
  });

  it("uses the fallback team list when the teams read fails (closed, not open)", async () => {
    const h = harness({ teamsError: true });
    const { replies } = await h.say({ id: "serve", title: "I want to serve" });
    expect(rowTitles(replies[0])).toEqual([...FALLBACK_TEAMS.map((t) => t.name), "Other"]);
  });

  it("pages a long team list: never more than 10 rows", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, name: `Team ${String(i + 1).padStart(2, "0")}` }));
    const h = harness({ teams: many });
    let r = await h.say("I want to serve");
    expect(rowIds(r.replies[0])).toHaveLength(10);
    expect(rowTitles(r.replies[0]).slice(-2)).toEqual(["More teams", "Other"]);
    r = await h.say({ id: "teams:page:1", title: "More teams" });
    expect(rowTitles(r.replies[0])).toEqual(["Team 09", "Team 10", "Team 11", "Team 12", "Team 13", "Team 14", "More teams", "Other"]);
  });

  it("“Talk to a person” mid-serve hands off; nothing more until a pastor resumes", async () => {
    const h = harness({ teams: TEAMS });
    await h.say("I want to serve");
    let r = await h.say("talk to a person");
    expect(r.replies.map(bodyOf)).toEqual([HANDOFF_HUMAN]);
    expect(h.thread()).toMatchObject({ bot_mode: "handed_off", bot_handoff_reason: "human" });
    expect(h.store.sessions.every((s) => s.closed_at)).toBe(true);
    expect(h.store.interests).toHaveLength(0);

    r = await h.say("Hello?");
    expect(r.replies).toHaveLength(0);
    expect(r.results[0].outcome).toBe("paused");
    r = await h.say("menu");
    expect(r.replies).toHaveLength(0);

    // A pastor resumes: the next message gets the welcome again.
    await h.store.setBotMode(h.thread().id, { mode: "on", reason: null, by: null, at: new Date().toISOString() });
    r = await h.say("Hi again");
    expect(bodyOf(r.replies[0])).toBe(WELCOME);
  });

  it("“pastor”, “human” and a tapped Talk to a person all hand off", async () => {
    for (const input of ["pastor", "Human", { id: "human", title: "Talk to a person" }] as const) {
      const h = harness();
      await h.say("Hi");
      const r = await h.say(input);
      expect(r.replies.map(bodyOf)).toEqual([HANDOFF_HUMAN]);
      expect(h.thread().bot_handoff_reason).toBe("human");
    }
  });
});

describe("deferred menu rows", () => {
  it.each(["new", "house", "care", "feedback"])("“%s” hands off to a pastor and starts no funnel", async (id) => {
    const h = harness();
    await h.say("Hi");
    const r = await h.say({ id, title: MAIN_MENU.find((m) => m.id === id)!.title });
    expect(r.replies.map(bodyOf)).toEqual([HANDOFF_DEFERRED]);
    expect(h.thread()).toMatchObject({ bot_mode: "handed_off", bot_handoff_reason: "deferred" });
    expect(h.store.sessions.filter((s) => !s.closed_at)).toHaveLength(0);
    expect(h.store.interests).toHaveLength(0);
    expect((await h.say("still there?")).replies).toHaveLength(0);
  });
});

describe("misses", () => {
  it("says it didn't catch that, re-sends the list, and after two misses puts Talk to a person first", async () => {
    const h = harness();
    await h.say("Hi");
    let r = await h.say("blue");
    expect(bodyOf(r.replies[0])).toBe(FALLBACK);
    expect(rowIds(r.replies[0])).toEqual(MAIN_MENU.map((m) => m.id));
    r = await h.say("green");
    expect(rowIds(r.replies[0])[0]).toBe("human");
    expect(rowIds(r.replies[0])).toHaveLength(6);
  });

  it("puts Talk to a person first on a button step too", async () => {
    const h = harness();
    await h.say("I want to serve");
    await h.say("Kids");
    await h.say("Done");
    await h.say("Most Sundays");
    await h.say("maybe");
    const r = await h.say("dunno");
    expect(r.replies[0].interactive?.type).toBe("list");
    expect(rowIds(r.replies[0])).toEqual(["human", "exp:yes", "exp:a_little", "exp:not_yet"]);
    expect(bodyOf(r.replies[0])).toBe(`${FALLBACK}\n\nHave you served on a church team before?`);
  });

  it("“menu” starts over from any step (the unfinished answer is dropped)", async () => {
    const h = harness();
    await h.say("I want to serve");
    await h.say("Kids");
    const r = await h.say("Menu");
    expect(bodyOf(r.replies[0])).toBe(WELCOME);
    expect(h.store.interests).toHaveLength(0);
    expect(h.store.sessions.find((s) => !s.closed_at)).toMatchObject({ flow: "menu", step: "main" });
  });
});

describe("STOP and START", () => {
  it("STOP: the opt-out is stored and the menu sends nothing", async () => {
    const h = harness();
    await h.say("Hi");
    const r = await h.say("STOP");
    expect(r.replies).toHaveLength(0);
    expect(r.results[0].outcome).toBe("opt_out");
    expect(h.thread().opted_out_at).not.toBeNull();
    expect((await h.say("hello")).replies).toHaveLength(0);
  });

  it("START lifts the opt-out and brings the menu back, when the bot is on", async () => {
    const h = harness();
    await h.say("STOP");
    const r = await h.say("START");
    expect(h.thread().opted_out_at).toBeNull();
    expect(bodyOf(r.replies[0])).toBe(WELCOME);
  });

  it("START while a pastor has the chat lifts the opt-out but the menu stays quiet", async () => {
    const h = harness();
    await h.say("STOP");
    await h.store.setBotMode(h.thread().id, { mode: "paused", reason: "pastor", by: "pastor-1", at: new Date().toISOString() });
    const r = await h.say("yes");
    expect(h.thread().opted_out_at).toBeNull();
    expect(r.replies).toHaveLength(0);
  });

  it("a tapped “Yes” button answers the question; it isn't an opt-in", async () => {
    const h = harness();
    await h.say("I want to serve");
    await h.say("Kids");
    await h.say("Done");
    await h.say("Most Sundays");
    await h.say({ id: "exp:yes", title: "Yes", kind: "button" });
    const tapped = h.store.messages.find((m) => m.wa_reply_id === "exp:yes");
    expect(tapped?.opt_change).toBeNull();
    expect(h.store.interests[0].experience).toBe("yes");
  });

  it("a STOP that lands between the decision and the send stops the send", async () => {
    const h = harness();
    const { outcome } = await h.say("Hi", { run: false });
    // The opt-out arrives (a newer message) before the queued job runs.
    h.thread().opted_out_at = new Date().toISOString();
    const result = await processBotJob(h.deps, outcome.jobs[0]);
    expect(result.outcome).toBe("opted_out");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});

describe("the 24-hour window", () => {
  it("never sends when the job runs after the window has closed", async () => {
    const h = harness();
    const { outcome } = await h.say("Hi", { run: false });
    h.advance(24 * 60 * 60 * 1000 + 60_000);
    const result = await processBotJob(h.deps, outcome.jobs[0]);
    expect(result.outcome).toBe("window_closed");
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.store.messages.filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("checks the thread's own last message too, not just the job's time", async () => {
    const h = harness();
    const { outcome } = await h.say("Hi", { run: false });
    // The thread's last inbound is stale (e.g. a bug queued this late), even though the job's own time looks fine.
    h.thread().last_inbound_at = new Date(START - 25 * 60 * 60 * 1000).toISOString();
    const result = await processBotJob(h.deps, outcome.jobs[0]);
    expect(result.sent).toBe(0);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});

describe("one answer per inbound message", () => {
  it("the same wamid delivered twice sends the menu once", async () => {
    const h = harness();
    const first = await h.say("Hi", { wamid: "wamid.SAME" });
    const job = first.outcome.jobs[0];
    // Meta retries: the webhook stores nothing new, so there is no job…
    const again = await h.say("Hi", { wamid: "wamid.SAME" });
    expect(again.outcome.jobs).toHaveLength(0);
    // …and even a job queued twice by mistake is answered once.
    const replay = await processBotJob(h.deps, job);
    expect(replay.outcome).toBe("duplicate");
    expect(h.sent).toHaveLength(1);
    expect(h.store.outbox.filter((o) => o.purpose === "reply")).toHaveLength(1);
  });

  it("answers a thread's messages in order and skips an older one that arrives after a newer one was answered", async () => {
    const h = harness();
    const older = await h.say("Hi", { at: START + 1_000, run: false });
    const newer = await h.say("I want to serve", { at: START + 5_000, run: false });
    await processBotJob(h.deps, newer.outcome.jobs[0]);
    const late = await processBotJob(h.deps, older.outcome.jobs[0]);
    expect(late.outcome).toBe("stale");
    expect(h.sent).toHaveLength(1);
    expect(bodyOf(h.sent[0])).toBe(SERVE_TEAMS);
  });

  it("runBotJobs sorts by time and runs one thread at a time", async () => {
    const h = harness();
    const a = await h.say("Hi", { at: START + 1_000, run: false });
    const b = await h.say("I want to serve", { at: START + 2_000, run: false });
    const jobs: BotJob[] = [...b.outcome.jobs, ...a.outcome.jobs];
    await runBotJobs(jobs, h.deps);
    expect(h.sent.map(bodyOf)).toEqual([WELCOME, SERVE_TEAMS]);
  });

  it("runBotJobs never throws (a missing 397 is logged, nothing sent)", async () => {
    const h = harness();
    const { outcome } = await h.say("Hi", { run: false });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.store.claimTurn = async () => {
      throw new (await import("../store")).WhatsAppNotInstalledError();
    };
    await expect(runBotJobs(outcome.jobs, h.deps)).resolves.toBeUndefined();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("[missio-whatsapp-bot] not installed (397); nothing sent");
    spy.mockRestore();
  });
});

describe("pause", () => {
  it("a paused thread gets nothing", async () => {
    const h = harness();
    await h.say("Hi");
    await h.store.setBotMode(h.thread().id, { mode: "paused", reason: "pastor", by: "pastor-1", at: new Date().toISOString() });
    const r = await h.say("I want to serve");
    expect(r.replies).toHaveLength(0);
    expect(r.results[0].outcome).toBe("paused");
  });

  it("a pastor pausing between the decision and the send stops the send", async () => {
    const h = harness();
    const { outcome } = await h.say("Hi", { run: false });
    const realEnqueue = h.store.enqueueReply.bind(h.store);
    h.store.enqueueReply = async (input) => {
      const row = await realEnqueue(input);
      await h.store.setBotMode(h.thread().id, { mode: "paused", reason: "pastor", by: "pastor-1", at: new Date().toISOString() });
      return row;
    };
    const result = await processBotJob(h.deps, outcome.jobs[0]);
    expect(result.sent).toBe(0);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.store.outbox.find((o) => o.purpose === "reply")).toMatchObject({ status: "failed", error_title: "Not sent: a pastor has the chat" });
  });

  it("a failed Graph send is kept in the thread as failed", async () => {
    const h = harness();
    h.fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 }));
    const r = await h.say("Hi");
    expect(r.results[0]).toMatchObject({ outcome: "answered", sent: 0, failed: 1 });
    expect(h.store.messages.find((m) => m.direction === "out")).toMatchObject({ status: "failed", error_code: 131047 });
  });
});
