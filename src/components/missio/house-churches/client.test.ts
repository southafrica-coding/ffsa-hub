import { describe, expect, it } from "vitest";
import { MissioApiError } from "../api";
import { createHouseChurchesClient, houseChurchesApi, houseErrorCopy } from "./client";
import type { HouseDetail, HouseSummary, ReviewItem } from "./types";

const amina = {
  contactId: "contact-amina",
  displayName: "Amina Kruger",
  firstName: "Amina",
  lastName: "Kruger",
  orgPersonId: "person-amina",
};

const house: HouseSummary = {
  id: "house-4",
  number: 4,
  name: null,
  campus: "potch",
  meetingDay: "Thursday",
  location: "14 Baobab Street",
  memberCount: 6,
  leaders: [amina],
  coLeaders: [],
};

const detail: HouseDetail = {
  ...house,
  leaderNotes: "Bring the soup pot.",
  members: [{ ...amina, role: "leader", startedAt: "2024-03-12" }],
};

const reviewItem: ReviewItem = {
  id: "review-1",
  status: "pending",
  sourceLine: 4,
  rawName: "The Adler family",
  kind: "family_label",
  matchType: "none",
  houseNumber: 4,
  house: { id: "house-4", number: 4, name: null },
  role: "leader",
  candidates: [amina],
  notes: "see house 4",
  createdAt: "2026-11-01T08:00:00.000Z",
  resolvedAt: null,
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

describe("house church fetchers", () => {
  it("lists houses and keeps canWrite", async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ houses: [house], canWrite: true }));
    const client = createHouseChurchesClient(fetchImpl);
    const page = await client.listHouses();
    expect(calls[0]?.url).toBe(houseChurchesApi.list);
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect(page.canWrite).toBe(true);
    expect(page.houses[0]).toMatchObject({ id: "house-4", number: 4, name: null, memberCount: 6 });
    expect(page.houses[0]?.leaders[0]).toMatchObject({ contactId: "contact-amina", orgPersonId: "person-amina" });
  });

  it("loads one house", async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ house: detail, canWrite: false }));
    const client = createHouseChurchesClient(fetchImpl);
    const body = await client.getHouse("house 4");
    expect(calls[0]?.url).toBe("/api/missio/house-churches/house%204");
    expect(body.canWrite).toBe(false);
    expect(body.house.members[0]).toMatchObject({ role: "leader", startedAt: "2024-03-12" });
    expect(body.house.leaderNotes).toBe("Bring the soup pot.");
  });

  it("adds, updates, and removes a member by contact id", async () => {
    const { fetchImpl, calls } = mockFetch((url, init) => {
      if (init?.method === "DELETE") return json({ ok: true });
      return json({ member: detail.members[0] }, init?.method === "POST" ? 201 : 200);
    });
    const client = createHouseChurchesClient(fetchImpl);
    await client.addMember("house-4", { contactId: "contact-amina", role: "member" });
    await client.updateMemberRole("house-4", "contact-amina", "co_leader");
    const removed = await client.removeMember("house-4", "contact-amina");
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ["/api/missio/house-churches/house-4/members", "POST"],
      ["/api/missio/house-churches/house-4/members/contact-amina", "PATCH"],
      ["/api/missio/house-churches/house-4/members/contact-amina", "DELETE"],
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ contactId: "contact-amina", role: "member" });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ role: "co_leader" });
    expect(removed).toEqual({ ok: true });
  });

  it("loads the pending review queue and posts each resolve body", async () => {
    const { fetchImpl, calls } = mockFetch((url, init) => {
      if (init?.method === "POST") {
        return json({
          item: { ...reviewItem, status: "matched", resolvedAt: "2026-11-02T08:00:00.000Z" },
          member: { contactId: "contact-amina", role: "member" },
        });
      }
      return json({ items: [reviewItem] });
    });
    const client = createHouseChurchesClient(fetchImpl);
    const queue = await client.listReview();
    expect(calls[0]?.url).toBe("/api/missio/house-churches/import-review?status=pending");
    expect(queue.items[0]?.rawName).toBe("The Adler family");
    expect(queue.items[0]?.candidates).toHaveLength(1);

    const linked = await client.resolveReview("review-1", { action: "link", contactId: "contact-amina" });
    await client.resolveReview("review-1", { action: "create", firstName: "Elise", lastName: "Navarro" });
    await client.resolveReview("review-1", { action: "skip", notes: "A household, not one person" });
    await client.resolveReview("review-1", { action: "skip" });
    expect(linked.item.status).toBe("matched");
    expect(linked.member).toEqual({ contactId: "contact-amina", role: "member" });
    expect(calls.slice(1).map((call) => JSON.parse(String(call.init?.body)))).toEqual([
      { action: "link", contactId: "contact-amina" },
      { action: "create", firstName: "Elise", lastName: "Navarro" },
      { action: "skip", notes: "A household, not one person" },
      { action: "skip" },
    ]);
    expect(calls[1]?.url).toBe(houseChurchesApi.resolve("review-1"));
  });

  it("keeps error codes, including 409 and retry-after", async () => {
    const cases: Array<{ status: number; body: unknown; headers?: Record<string, string>; code: string }> = [
      { status: 403, body: { error: "no", code: "forbidden" }, code: "forbidden" },
      { status: 404, body: { error: "missing", code: "not_found" }, code: "not_found" },
      { status: 409, body: { error: "dup", code: "already_member" }, code: "already_member" },
      { status: 409, body: { error: "done", code: "already_resolved" }, code: "already_resolved" },
      { status: 409, body: { error: "exists", code: "exists_use_search" }, code: "exists_use_search" },
      { status: 429, body: { error: "slow", code: "rate_limited" }, headers: { "retry-after": "12" }, code: "rate_limited" },
      { status: 401, body: { error: "signed out", code: "unauthenticated" }, code: "unauthenticated" },
    ];
    for (const item of cases) {
      const { fetchImpl } = mockFetch(() => json(item.body, item.status, item.headers));
      const client = createHouseChurchesClient(fetchImpl);
      await expect(client.listHouses()).rejects.toMatchObject({
        name: "MissioApiError",
        code: item.code,
        status: item.status,
      });
    }
    const { fetchImpl } = mockFetch(() => json({ error: "slow", code: "rate_limited" }, 429, { "retry-after": "12" }));
    const client = createHouseChurchesClient(fetchImpl);
    await expect(client.listHouses()).rejects.toMatchObject({ retryAfterSeconds: 12 });
  });

  it("rejects a payload that is not the contract", async () => {
    const { fetchImpl } = mockFetch(() => json({ houses: {}, canWrite: true }));
    const client = createHouseChurchesClient(fetchImpl);
    await expect(client.listHouses()).rejects.toBeInstanceOf(MissioApiError);
  });

  it("parses a #616 review item, including a numeric line and a null kind", async () => {
    const shaped = {
      ...reviewItem,
      kind: null,
      matchType: null,
      extraFromBackend: true,
      candidates: [{ ...amina, nickname: "A" }],
    };
    const { fetchImpl } = mockFetch(() => json({ items: [shaped] }));
    const client = createHouseChurchesClient(fetchImpl);
    const queue = await client.listReview();
    expect(queue.items[0]).toMatchObject({
      sourceLine: 4,
      rawName: "The Adler family",
      kind: null,
      matchType: null,
      role: "leader",
      notes: "see house 4",
    });
    expect(queue.items[0]).not.toHaveProperty("extraFromBackend");
  });

  it("maps every pinned code to fixed copy and drops the server message", async () => {
    const serverText = "insert or update violates foreign key constraint fk_house_church_members";
    const cases: Array<{ status: number; code: string; copy: string; fieldErrors?: Record<string, string[]> }> = [
      { status: 400, code: "invalid_input", copy: "Check the details and try again." },
      { status: 400, code: "not_missio_person", copy: "This person isn’t in Missio yet. Add them in Missio People first." },
      { status: 404, code: "not_found", copy: "That couldn’t be found." },
      { status: 409, code: "already_member", copy: "They’re already in this house." },
      { status: 409, code: "already_resolved", copy: "Someone else already sorted this one." },
      { status: 409, code: "membership_not_current", copy: "They’re no longer in this house." },
      { status: 409, code: "ended_at_in_future", copy: "That end date is still in the future." },
      { status: 409, code: "exists_use_search", copy: "This person already exists. Open Missio People, then Add person." },
      { status: 429, code: "rate_limited", copy: "Too many attempts, try again in 12 seconds" },
      { status: 500, code: "server_error", copy: "Something went wrong on our side. Try again." },
      { status: 409, code: "brand_new_code", copy: "That didn’t work. Try again." },
    ];
    for (const item of cases) {
      const { fetchImpl } = mockFetch(() =>
        json({ error: serverText, code: item.code, message: serverText, fieldErrors: item.fieldErrors }, item.status, item.code === "rate_limited" ? { "retry-after": "12" } : {})
      );
      const client = createHouseChurchesClient(fetchImpl);
      await expect(client.listHouses()).rejects.toMatchObject({ code: item.code });
      try {
        await client.listHouses();
      } catch (caught) {
        expect(caught).toBeInstanceOf(MissioApiError);
        const error = caught as MissioApiError;
        expect(houseErrorCopy(error)).toBe(item.copy);
        expect(houseErrorCopy(error)).not.toContain("foreign key");
        expect(error.message).not.toContain("foreign key");
      }
    }

    const { fetchImpl } = mockFetch(() =>
      json({ error: serverText, code: "invalid_input", fieldErrors: { contactId: ["Pick someone from Missio."] } }, 400)
    );
    const client = createHouseChurchesClient(fetchImpl);
    try {
      await client.listHouses();
    } catch (caught) {
      const error = caught as MissioApiError;
      expect(houseErrorCopy(error)).toBe("Pick someone from Missio.");
      expect(houseErrorCopy(error)).not.toContain("foreign key");
    }
  });
});
