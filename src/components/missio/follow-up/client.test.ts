import { describe, expect, it } from "vitest";
import { MissioApiError } from "../api";
import { createFollowUpClient, followUpApi } from "./client";
import type { FollowUpItem, TimelineEntry } from "./types";

/** Shaped like the follow-up contract: contact rows hide phone and email, connect cards keep only the phone. */
const contactItem = {
  key: "c_contact-elena",
  source: "contact",
  contactId: "contact-elena",
  connectResponseId: null,
  followupId: "follow-elena",
  displayName: "Elena Voss",
  phone: null,
  email: null,
  visitType: "regular",
  wantsHouseChurch: true,
  wantsPrayer: null,
  stage: "contacted",
  assignedLeader: {
    contactId: "contact-chris",
    displayName: "Chris Naidoo",
    firstName: "Chris",
    lastName: "Naidoo",
    orgPersonId: "person-chris",
    extraFlag: true,
  },
  submittedAt: "2026-11-10T06:00:00.000Z",
  serverOnly: "hide me",
};

const cardItem = {
  key: "r_response-1",
  source: "connect_response",
  contactId: null,
  connectResponseId: "response-1",
  followupId: null,
  displayName: "Lerato Mokoena",
  phone: "082 555 0142",
  email: null,
  visitType: "first_time",
  wantsHouseChurch: true,
  wantsPrayer: true,
  stage: "new",
  assignedLeader: null,
  submittedAt: "2026-11-16T08:30:00.000Z",
  debug: { raw: "nope" },
};

const entry: TimelineEntry = {
  id: "entry-1",
  kind: "stage_change",
  fromStage: "new",
  toStage: "contacted",
  body: null,
  by: { displayName: "Chris Naidoo" },
  at: "2026-11-16T09:00:00.000Z",
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

describe("follow-up fetchers", () => {
  it("lists a stage, keeps null phones on contacts, and ignores extra fields", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json({ people: [contactItem, cardItem], canWrite: true, page: 1 })
    );
    const client = createFollowUpClient(fetchImpl);
    const page = await client.list({ stage: "new", leader: "unassigned" });
    expect(calls[0]?.url).toBe("/api/missio/follow-up?stage=new&leader=unassigned");
    expect(page.canWrite).toBe(true);
    expect(page.people[0]).toMatchObject({
      key: "c_contact-elena",
      phone: null,
      email: null,
      stage: "contacted",
    });
    expect(page.people[0]?.assignedLeader).toMatchObject({ contactId: "contact-chris", orgPersonId: "person-chris" });
    expect(page.people[1]).toMatchObject({
      key: "r_response-1",
      phone: "082 555 0142",
      email: null,
      contactId: null,
      followupId: null,
    });
    expect(page.people[0]).not.toHaveProperty("serverOnly");
    expect(page.people[1]).not.toHaveProperty("debug");
  });

  it("patches stage and leader, posts a note, and creates a contact for an r_ card", async () => {
    const updated: FollowUpItem = {
      key: cardItem.key,
      source: "connect_response",
      contactId: "contact-lerato",
      connectResponseId: "response-1",
      followupId: "follow-lerato",
      displayName: cardItem.displayName,
      phone: cardItem.phone,
      email: null,
      visitType: "first_time",
      wantsHouseChurch: true,
      wantsPrayer: true,
      stage: "contacted",
      assignedLeader: null,
      submittedAt: cardItem.submittedAt,
    };
    const { fetchImpl, calls } = mockFetch((url, init) => {
      if (init?.method === "POST" && url.endsWith("/contact")) {
        return json({ person: { ...updated, stage: "new" } }, 200);
      }
      if (init?.method === "POST") return json({ entry: { ...entry, kind: "note", body: "Left a message." } }, 201);
      if (url.endsWith("/leaders")) {
        return json({ leaders: [contactItem.assignedLeader], total: 9 });
      }
      if (url.endsWith("/timeline") && !init?.method) return json({ entries: [entry, { ...entry, id: "extra-null", kind: "note", body: null, by: null, fromStage: null, toStage: null }] });
      return json({ person: updated, entry });
    });
    const client = createFollowUpClient(fetchImpl);
    const staged = await client.setStage("r_response-1", { stage: "contacted", note: "  " });
    const led = await client.setLeader("c_contact-elena", null);
    const noted = await client.addNote("r_response-1", "Left a message.");
    const timeline = await client.timeline("r_response-1");
    const leaders = await client.leaders();
    const created = await client.createContact("r_response-1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ stage: "contacted" });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ leaderContactId: null });
    expect(calls.map((call) => call.url)).toEqual([
      followUpApi.stage("r_response-1"),
      followUpApi.leader("c_contact-elena"),
      followUpApi.timeline("r_response-1"),
      followUpApi.timeline("r_response-1"),
      followUpApi.leaders,
      followUpApi.contact("r_response-1"),
    ]);
    expect(staged.person.stage).toBe("contacted");
    expect(led.entry.kind).toBe("stage_change");
    expect(noted.entry.body).toBe("Left a message.");
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[1]?.body).toBeNull();
    expect(leaders.leaders[0]?.displayName).toBe("Chris Naidoo");
    expect(created.person.contactId).toBe("contact-lerato");
    expect(created.person.email).toBeNull();
  });

  it("keeps the code and drops the server sentence", async () => {
    const cases = [
      { status: 400, body: { error: "This person is not in Missio.", code: "not_missio_person" }, code: "not_missio_person" },
      { status: 404, body: { error: "Missing row", code: "not_found" }, code: "not_found" },
      { status: 409, body: { error: "This row is already resolved.", code: "already_resolved" }, code: "already_resolved" },
      { status: 409, body: { error: "dup", code: "already_member" }, code: "already_member" },
      { status: 409, body: { error: "stale", code: "membership_not_current" }, code: "membership_not_current" },
      { status: 409, body: { error: "future", code: "ended_at_in_future" }, code: "ended_at_in_future" },
      { status: 409, body: { error: "exists", code: "exists_use_search" }, code: "exists_use_search" },
      { status: 401, body: { error: "nope", code: "unauthenticated" }, code: "unauthenticated" },
      { status: 403, body: { error: "nope", code: "forbidden" }, code: "forbidden" },
      { status: 429, body: { error: "slow down", code: "rate_limited" }, code: "rate_limited", headers: { "retry-after": "15" } },
      { status: 500, body: { error: "Something went wrong.", code: "server_error" }, code: "server_error" },
      { status: 409, body: { error: "RAW SERVER TEXT" }, code: "already_resolved" },
    ];
    for (const item of cases) {
      const { fetchImpl } = mockFetch(() => json(item.body, item.status, item.headers));
      const client = createFollowUpClient(fetchImpl);
      await expect(client.list({ stage: "new" })).rejects.toMatchObject({
        code: item.code,
        message: "",
        ...(item.code === "rate_limited" ? { retryAfterSeconds: 15 } : {}),
      });
      try {
        await client.list({ stage: "new" });
      } catch (error) {
        expect(error).toBeInstanceOf(MissioApiError);
        expect((error as Error).message).not.toContain("RAW");
        expect((error as Error).message).not.toContain("Something went wrong");
      }
    }
  });
});
