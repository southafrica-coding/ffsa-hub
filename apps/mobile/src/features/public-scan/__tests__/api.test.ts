import { createScanGate } from "@/features/tickets/scan-gate";
import { ApiError } from "@/lib/api";

import {
  createPublicFetch,
  doorKey,
  getScanEvent,
  isDeadLinkError,
  parseScanToken,
  scanApiPath,
  volunteerDoorClient,
  webScanPath,
} from "../api";
import { cleanScannerName } from "../scanner-name";
import { linkErrorMessage } from "../use-scan-link";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";
const BASE = "https://hub.test";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return { calls, impl: impl as unknown as typeof fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("scan link tokens and paths", () => {
  it("accepts the website's 48-hex tokens, trims, and takes the first of an array param", () => {
    expect(parseScanToken(TOKEN)).toBe(TOKEN);
    expect(parseScanToken(` ${TOKEN} `)).toBe(TOKEN);
    expect(parseScanToken([TOKEN, "x"])).toBe(TOKEN);
  });

  it("rejects anything that can't be a link before any request is made", () => {
    for (const bad of [undefined, null, "", "short", "has space in it 1234567", "../../api/me/1234567890", "x".repeat(129), 42]) {
      expect(parseScanToken(bad)).toBeNull();
    }
  });

  it("builds the public API and website paths", () => {
    expect(scanApiPath(TOKEN)).toBe(`/api/scan/${TOKEN}`);
    expect(webScanPath(TOKEN)).toBe(`/scan/${TOKEN}`);
  });

  it("doorKey is stable, per link, and never contains the token", () => {
    const other = TOKEN.replace("a1", "ff");
    expect(doorKey(TOKEN)).toBe(doorKey(TOKEN));
    expect(doorKey(TOKEN)).not.toBe(doorKey(other));
    expect(doorKey(TOKEN)).toMatch(/^link:[0-9a-f]{16}$/);
    expect(doorKey(TOKEN)).not.toContain(TOKEN.slice(0, 8));
  });
});

describe("createPublicFetch (no session)", () => {
  it("sends no Authorization header and no cookies, even if a caller passes one", async () => {
    const f = fakeFetch(() => json({ checkedIn: 1, total: 2 }));
    const fetcher = createPublicFetch({ baseUrl: BASE, fetchImpl: f.impl });
    await fetcher("/api/scan/x", { headers: { Authorization: "Bearer leaked" } });
    const headers = f.calls[0].init.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Accept")).toBe("application/json");
    expect(f.calls[0].init.credentials).toBe("omit");
    expect(f.calls[0].url).toBe(`${BASE}/api/scan/x`);
  });

  it("keeps the server's own sentence for a dead link (404) and too many requests (429)", async () => {
    const dead = "This scanning link is no longer active. Ask the event organiser for a current one.";
    const fetcher = createPublicFetch({ baseUrl: BASE, fetchImpl: fakeFetch(() => json({ error: dead }, 404)).impl });
    const err = await fetcher("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "http", status: 404, message: dead });
    expect(isDeadLinkError(err)).toBe(true);

    const busy = createPublicFetch({ baseUrl: BASE, fetchImpl: fakeFetch(() => json({ error: "Too many requests. Wait a moment and try again." }, 429)).impl });
    await expect(busy("/x")).rejects.toMatchObject({ kind: "http", status: 429, message: "Too many requests. Wait a moment and try again." });
  });

  it("uses the app's words for a server failure, and never signs anyone out on 401/403", async () => {
    const boom = createPublicFetch({ baseUrl: BASE, fetchImpl: fakeFetch(() => json({ error: "stack trace…" }, 500)).impl });
    await expect(boom("/x")).rejects.toMatchObject({ kind: "http", status: 500, message: "Something went wrong on the server (500). Try again." });
    const refused = createPublicFetch({ baseUrl: BASE, fetchImpl: fakeFetch(() => json({ error: "unauthenticated" }, 401)).impl });
    await expect(refused("/x")).rejects.toMatchObject({ kind: "http", status: 401 });
  });

  it("no connection is a network error (so the door queues the scan)", async () => {
    const fetcher = createPublicFetch({
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new TypeError("Network request failed");
      }) as unknown as typeof fetch,
    });
    await expect(fetcher("/x")).rejects.toMatchObject({ kind: "network" });
  });

  it("a server that doesn't answer in time is a timeout", async () => {
    const fetcher = createPublicFetch({
      baseUrl: BASE,
      timeoutMs: 5,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch,
    });
    await expect(fetcher("/x")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("a body that doesn't match the schema is invalid_response", async () => {
    const fetcher = createPublicFetch({ baseUrl: BASE, fetchImpl: fakeFetch(() => json({ nope: true })).impl });
    await expect(getScanEvent(fetcher, TOKEN)).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("volunteerDoorClient", () => {
  function door(name?: string | null) {
    const f = fakeFetch((url, init) => {
      if (url.includes("?stats=1")) return json({ checkedIn: 3, total: 9 });
      if (url.includes("?q=")) return json({ guests: [{ ticketId: "t1", code: "C1", name: "Sarah Mokoena", ticketTypeName: null, status: "valid", checkedInAt: null }] });
      const body = JSON.parse(String(init.body));
      if (body.undo) return json({ result: "undone" });
      return json({ result: "ok", ticketId: "t1", ticketTypeName: "General", buyerName: "Sarah" });
    });
    return { f, client: volunteerDoorClient(createPublicFetch({ baseUrl: BASE, fetchImpl: f.impl }), TOKEN, { scannerName: name }) };
  }

  it("speaks the four verbs of /api/scan/[token]", async () => {
    const { f, client } = door("Thandi");
    expect(await client.stats()).toEqual({ checkedIn: 3, total: 9 });
    expect(await client.search("sarah mok")).toEqual([
      { ticketId: "t1", code: "C1", name: "Sarah Mokoena", ticketTypeName: "Ticket", status: "valid", checkedInAt: null },
    ]);
    expect(await client.checkIn("AbCdEfGhIjK")).toMatchObject({ result: "ok", ticketId: "t1" });
    await client.undo("t1");

    expect(f.calls.map((c) => [c.init.method ?? "GET", c.url.replace(BASE, "")])).toEqual([
      ["GET", `/api/scan/${TOKEN}?stats=1`],
      ["GET", `/api/scan/${TOKEN}?q=sarah%20mok`],
      ["POST", `/api/scan/${TOKEN}`],
      ["POST", `/api/scan/${TOKEN}`],
    ]);
    expect(JSON.parse(String(f.calls[2].init.body))).toEqual({ code: "AbCdEfGhIjK", scannerName: "Thandi" });
    expect(JSON.parse(String(f.calls[3].init.body))).toEqual({ undo: "t1" });
  });

  it("records the volunteer's name trimmed and capped, or not at all", async () => {
    const long = door(`  ${"N".repeat(80)}  `);
    await long.client.checkIn("AbCdEfGhIjK");
    expect(JSON.parse(String(long.f.calls[0].init.body)).scannerName).toHaveLength(60);

    const none = door("   ");
    await none.client.checkIn("AbCdEfGhIjK");
    expect(JSON.parse(String(none.f.calls[0].init.body))).toEqual({ code: "AbCdEfGhIjK" });
  });

  it("the Tickets scan gate is reused unchanged: one ticket in front of the lens is sent once", () => {
    const gate = createScanGate(8_000);
    expect(gate.accept("AbCdEfGhIjK", 0)).toBe(true);
    gate.release();
    expect(gate.accept("AbCdEfGhIjK", 2_000)).toBe(false);
    expect(gate.accept("ZyXwVuTsRqP", 2_100)).toBe(true);
  });
});

describe("getScanEvent", () => {
  it("reads the title and start date from /api/scan/[token]/event", async () => {
    const f = fakeFetch(() => json({ event: { title: "Send Night", startDate: "2026-11-07" } }));
    const fetcher = createPublicFetch({ baseUrl: BASE, fetchImpl: f.impl });
    expect(await getScanEvent(fetcher, TOKEN)).toEqual({ title: "Send Night", startDate: "2026-11-07" });
    expect(f.calls[0].url).toBe(`${BASE}/api/scan/${TOKEN}/event`);
  });
});

describe("plain-English first-load errors", () => {
  it("offline, busy, and the server's own words", () => {
    expect(linkErrorMessage(new ApiError("network", "x"))).toMatch(/You're offline/);
    expect(linkErrorMessage(new ApiError("timeout", "x"))).toMatch(/You're offline/);
    expect(linkErrorMessage(new ApiError("http", "x", 429))).toMatch(/Wait a moment/);
    expect(linkErrorMessage(new ApiError("http", "Something went wrong on the server (500). Try again.", 500))).toMatch(/\(500\)/);
    expect(linkErrorMessage(new Error("?"))).toBe("Something went wrong. Try again.");
  });

  it("names are trimmed and capped at 60", () => {
    expect(cleanScannerName("  Thandi  ")).toBe("Thandi");
    expect(cleanScannerName("x".repeat(70))).toHaveLength(60);
  });
});
