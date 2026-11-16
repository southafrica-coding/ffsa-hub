import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError, createApiFetch } from "@/lib/api";

import { getCheckInEvents, getMyTickets, getWaiverLink, staffDoorClient } from "../api";
import { loadCachedTickets, saveCachedTickets, ticketCacheKey } from "../ticket-cache";
import { makeTickets } from "../testing/fixtures";

// API contract: real createApiFetch, fake network. Checks paths, verbs,
// bodies, the bearer header, and tolerant parsing of the server's JSON.

function server(respond: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = respond(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const apiFetch = createApiFetch({
    baseUrl: "https://hub.test",
    getAccessToken: async () => "tok",
    onAuthFailure: jest.fn(),
    fetchImpl,
  });
  return { apiFetch, calls };
}

describe("GET /api/mobile/my-tickets", () => {
  it("sends the bearer token and parses tolerantly", async () => {
    const { apiFetch, calls } = server(() => ({
      body: {
        tickets: [
          {
            id: "t1",
            code: "AbCdEfGhIjK",
            status: "something-new",
            checkedInAt: null,
            ticketTypeName: null,
            holderName: null,
            event: { id: "e1", title: "Send Night", startDate: "2026-11-20" },
            futureField: 1,
          },
        ],
        serverTime: "2026-11-03T08:00:00Z",
      },
    }));
    const out = await getMyTickets(apiFetch);
    expect(calls[0].url).toBe("https://hub.test/api/mobile/my-tickets");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer tok");
    expect(out.tickets[0]).toMatchObject({
      status: "void",
      ticketTypeName: "Ticket",
      holderName: "",
      waiver: { required: false, signed: false, hasDocument: false },
      event: { startTime: null, location: null, status: "published" },
    });
    expect(out.registrations).toEqual([]);
  });

  it("rejects a response without tickets", async () => {
    const { apiFetch } = server(() => ({ body: { nope: true } }));
    await expect(getMyTickets(apiFetch)).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("waiver link and check-in events", () => {
  it("encodes the code and returns the link", async () => {
    const { apiFetch, calls } = server(() => ({ body: { url: "https://storage.test/x.pdf?t=1", expiresIn: 300 } }));
    expect(await getWaiverLink(apiFetch, "Ab_c-1")).toEqual({ url: "https://storage.test/x.pdf?t=1", expiresIn: 300 });
    expect(calls[0].url).toBe("https://hub.test/api/mobile/my-tickets/Ab_c-1/waiver");
  });

  it("403 on check-in events is a 'forbidden' ApiError", async () => {
    const { apiFetch } = server(() => ({ status: 403, body: { error: "Not authorized" } }));
    await expect(getCheckInEvents(apiFetch)).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("staffDoorClient → /api/events/[id]/check-in", () => {
  it("GET ?stats=1", async () => {
    const { apiFetch, calls } = server(() => ({ body: { checkedIn: 3, total: 40 } }));
    expect(await staffDoorClient(apiFetch, "e 1").stats()).toEqual({ checkedIn: 3, total: 40 });
    expect(calls[0].url).toBe("https://hub.test/api/events/e%201/check-in?stats=1");
  });

  it("GET ?q= returns guests", async () => {
    const { apiFetch, calls } = server(() => ({
      body: { guests: [{ ticketId: "t1", code: "AAAA", name: "Sample P", ticketTypeName: "G", status: "valid", checkedInAt: null }] },
    }));
    const guests = await staffDoorClient(apiFetch, "e1").search("sample p");
    expect(guests[0].name).toBe("Sample P");
    expect(calls[0].url).toBe("https://hub.test/api/events/e1/check-in?q=sample%20p");
  });

  it("POST {code} parses every server outcome", async () => {
    const outcomes = [
      { result: "ok", ticketId: "t1", ticketTypeName: "G", buyerName: "B" },
      { result: "already_checked_in", ticketTypeName: "G", checkedInAt: "2026-11-03T07:00:00Z" },
      { result: "void" },
      { result: "invalid" },
      { result: "wrong_event" },
    ];
    let i = 0;
    const { apiFetch, calls } = server(() => ({ body: outcomes[i++] }));
    const door = staffDoorClient(apiFetch, "e1");
    for (const o of outcomes) expect((await door.checkIn("AAAA")).result).toBe(o.result);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ code: "AAAA" });
  });

  it("POST {undo}", async () => {
    const { apiFetch, calls } = server(() => ({ body: { result: "undone" } }));
    await staffDoorClient(apiFetch, "e1").undo("t1");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ undo: "t1" });
  });

  it("an unknown outcome is an invalid response, not a silent success", async () => {
    const { apiFetch } = server(() => ({ body: { result: "maybe" } }));
    await expect(staffDoorClient(apiFetch, "e1").checkIn("AAAA")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("ticket cache (saved on this phone)", () => {
  beforeEach(() => AsyncStorage.clear());

  it("round-trips per user", async () => {
    const data = makeTickets();
    await saveCachedTickets("u1", data, "2026-11-03T08:00:00.000Z");
    expect(await loadCachedTickets("u1")).toEqual({ savedAt: "2026-11-03T08:00:00.000Z", data });
    expect(await loadCachedTickets("u2")).toBeNull();
  });

  it("treats junk as nothing saved", async () => {
    await AsyncStorage.setItem(ticketCacheKey("u1"), "{{");
    expect(await loadCachedTickets("u1")).toBeNull();
  });
});
