import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type MemoryStore } from "@/lib/missio/whatsapp/testing/memory-store";

// Fakes only: access, Supabase, the store and Graph are all stubbed. Nothing touches a DB or Meta.
const state = vi.hoisted(() => ({
  allow: "pastor" as "pastor" | "forbidden" | "signed-out",
  calls: [] as Array<{ slug: string; roles: readonly string[] | undefined }>,
  adminCreated: 0,
  store: null as unknown,
  userTableError: null as null | { code: string; message: string },
  threadRow: null as null | Record<string, unknown>,
  person: { contactId: "c1", name: "Test Person" } as { contactId: string; name: string } | { status: number },
  phone: "082 000 0001" as string | null,
  updates: [] as unknown[],
}));

vi.mock("@/lib/missio/access", () => ({
  MISSIO_SLUG: "missio",
  requireOrgRole: async (slug: string, roles?: readonly string[]) => {
    state.calls.push({ slug, roles });
    if (state.allow === "signed-out") return { response: NextResponse.json({ code: "unauthenticated" }, { status: 401 }) };
    if (state.allow === "forbidden") return { response: NextResponse.json({ code: "forbidden" }, { status: 403 }) };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
    chain.update = (row: unknown) => {
      state.updates.push(row);
      return chain;
    };
    chain.maybeSingle = async () => ({ data: state.userTableError ? null : state.threadRow, error: state.userTableError });
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: state.userTableError ? null : [], error: state.userTableError });
    return { user: { id: "pastor-1" }, orgId: "org-missio", roles: ["pastor"], supabase: { from: () => chain } };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCreated += 1;
    return {};
  },
}));
vi.mock("@/lib/missio/whatsapp/supabase-store", () => ({ supabaseWhatsAppStore: () => state.store }));
vi.mock("@/lib/missio/limit", () => ({ missioRateLimit: async () => null }));
vi.mock("@/lib/missio/whatsapp/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/missio/whatsapp/server")>();
  return {
    ...real,
    readContactPhone: async () => state.phone,
    threadDeps: (access: { supabase: unknown; orgId: string }) => ({
      supabase: access.supabase,
      orgId: access.orgId,
      sendReady: real.isSendReady(),
      loadPerson: async () => state.person,
      readPhone: async () => state.phone,
    }),
  };
});

import { GET as inbox } from "./route";
import { GET as thread } from "./thread/route";
import { POST as markRead } from "./thread/read/route";
import { GET as templates } from "./templates/route";
import { POST as send } from "./send/route";

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.T1" }] })));
const PERSON = "00000000-0000-4000-8000-000000000001";
const THREAD = "00000000-0000-4000-8000-000000000002";

function postJson(path: string, body: unknown) {
  return new Request(`https://hub.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

let store: MemoryStore;
beforeEach(() => {
  state.allow = "pastor";
  state.calls = [];
  state.adminCreated = 0;
  state.userTableError = null;
  state.threadRow = null;
  state.person = { contactId: "c1", name: "Test Person" };
  state.phone = "082 000 0001";
  state.updates = [];
  store = memoryStore();
  state.store = store;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("MISSIO_WHATSAPP_ACCESS_TOKEN", "test-token-not-real");
  vi.stubEnv("MISSIO_WHATSAPP_PHONE_NUMBER_ID", "100000000000001");
  vi.stubEnv("MISSIO_WHATSAPP_WABA_ID", "300000000000003");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function everyRoute() {
  return [
    await inbox(),
    await thread(new Request(`https://hub.test/api/missio/whatsapp/thread?person=${PERSON}`)),
    await markRead(postJson("/api/missio/whatsapp/thread/read", { threadId: THREAD })),
    await templates(new Request("https://hub.test/api/missio/whatsapp/templates")),
    await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" })),
  ];
}

describe("Missio WhatsApp routes: who gets in", () => {
  it("asks for the Missio pastor role on every route", async () => {
    await everyRoute();
    expect(state.calls).toHaveLength(5);
    for (const call of state.calls) expect(call).toEqual({ slug: "missio", roles: ["pastor"] });
  });

  it("signed out: 401 everywhere, before any database write or WhatsApp call", async () => {
    state.allow = "signed-out";
    for (const res of await everyRoute()) expect(res.status).toBe(401);
    expect(state.adminCreated).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("leaders, coaches and FFSA admins: 403 everywhere, before any database write or WhatsApp call", async () => {
    state.allow = "forbidden";
    for (const res of await everyRoute()) expect(res.status).toBe(403);
    expect(state.adminCreated).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe("Missio WhatsApp routes: switched off", () => {
  it("send answers 503 not_configured without the settings, and touches nothing", async () => {
    vi.stubEnv("MISSIO_WHATSAPP_ACCESS_TOKEN", "");
    const res = await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(state.adminCreated).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("templates answer 503 with a state the composer can show", async () => {
    vi.stubEnv("MISSIO_WHATSAPP_WABA_ID", "");
    const res = await templates(new Request("https://hub.test/api/missio/whatsapp/templates"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ state: "not_configured", templates: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the inbox reads as not_installed while 396 isn't applied", async () => {
    state.userTableError = { code: "42P01", message: 'relation "missio_whatsapp_threads" does not exist' };
    const res = await inbox();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setup: "not_installed", threads: [] });
  });

  it("mark read and send to a thread answer 503 not_installed while 396 isn't applied", async () => {
    state.userTableError = { code: "PGRST205", message: "Could not find the table 'public.missio_whatsapp_threads' in the schema cache" };
    expect((await markRead(postJson("/api/missio/whatsapp/thread/read", { threadId: THREAD }))).status).toBe(503);
    const res = await send(postJson("/api/missio/whatsapp/send", { threadId: THREAD, text: "Hi" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_installed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("send answers 503 not_installed when the store finds no tables", async () => {
    const { WhatsAppNotInstalledError } = await import("@/lib/missio/whatsapp/store");
    state.store = {
      ...store,
      findThread: async () => {
        throw new WhatsAppNotInstalledError();
      },
    };
    const res = await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" }));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Missio WhatsApp routes: send", () => {
  it("refuses free text to someone who hasn't written in 24 hours", async () => {
    const res = await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "template_required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses someone with no phone or a phone that won't work", async () => {
    state.phone = null;
    expect(await (await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" }))).json()).toMatchObject({ code: "no_phone" });
    state.phone = "call the office";
    expect(await (await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" }))).json()).toMatchObject({ code: "bad_phone" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses bad input: both targets, neither, or no content", async () => {
    for (const body of [{ text: "Hi" }, { personId: PERSON, threadId: THREAD, text: "Hi" }, { personId: PERSON }, { personId: "x", text: "Hi" }]) {
      expect((await send(postJson("/api/missio/whatsapp/send", body))).status).toBe(400);
    }
  });

  it("sends free text inside the window to the person's E.164 number", async () => {
    const t = await store.ensureThread({ orgId: "org-missio", e164: "+27820000001", waId: "27820000001", contactId: "c1", profileName: null });
    t.last_inbound_at = new Date(Date.now() - 60_000).toISOString();
    const res = await send(postJson("/api/missio/whatsapp/send", { personId: PERSON, text: "Hi" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ message: { direction: "out", status: "accepted", body: "Hi" }, threadId: t.id });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ to: "+27820000001", type: "text" });
  });
});

describe("Missio WhatsApp routes: reads", () => {
  it("thread by person answers before anyone has written", async () => {
    const res = await thread(new Request(`https://hub.test/api/missio/whatsapp/thread?person=${PERSON}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ setup: "ready", thread: null, person: { id: PERSON, name: "Test Person", phone: "+27 82 000 0001" }, blocked: null, messages: [] });
  });

  it("thread needs exactly one valid id", async () => {
    expect((await thread(new Request("https://hub.test/api/missio/whatsapp/thread"))).status).toBe(400);
    expect((await thread(new Request("https://hub.test/api/missio/whatsapp/thread?person=nope"))).status).toBe(400);
  });

  it("mark read resets only the unread count", async () => {
    state.threadRow = { id: THREAD };
    const res = await markRead(postJson("/api/missio/whatsapp/thread/read", { threadId: THREAD }));
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0] as object).sort()).toEqual(["last_read_at", "unread_count"]);
  });
});
