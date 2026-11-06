import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<
    typeof import("@/lib/testing/fake-supabase").createFakeSupabase
  >,
  campaign: null as null | {
    id: string;
    status: string;
    scheduled_at: string | null;
    name: string;
    subject: string;
    preview_text: string | null;
    sending_identity_id: string | null;
  },
  updates: [] as Array<{
    id: string;
    patch: Record<string, unknown>;
    options?: { onlyStatuses?: readonly string[] };
  }>,
  labels: [] as string[][],
  contacts: [] as string[][],
  conflict: false,
  deletes: [] as Array<{ id: string; options?: { onlyStatuses?: readonly string[] } }>,
  deleteMiss: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));
vi.mock("@/services/campaigns", () => ({
  getCampaignById: async () => ({ data: state.campaign, error: null }),
  updateCampaign: async (
    _s: unknown,
    id: string,
    patch: Record<string, unknown>,
    options?: { onlyStatuses?: readonly string[] }
  ) => {
    state.updates.push({ id, patch, options });
    if (state.conflict) return { data: null, error: null };
    return { data: { id, ...patch }, error: null };
  },
  deleteCampaign: async (
    _s: unknown,
    id: string,
    options?: { onlyStatuses?: readonly string[] }
  ) => {
    state.deletes.push({ id, options });
    if (state.deleteMiss) return { data: null, error: null };
    return { data: { id }, error: null };
  },
  setCampaignLabels: async (_s: unknown, _id: string, labelIds: string[]) => {
    state.labels.push(labelIds);
    return { error: null };
  },
  setCampaignContacts: async (_s: unknown, _id: string, contactIds: string[]) => {
    state.contacts.push(contactIds);
    return { error: null };
  },
}));

import { DELETE, GET, PATCH } from "./route";

const FUTURE = "2026-12-01T08:00:00.000Z";
const FUTURE_SAME_INSTANT = "2026-12-01T10:00:00+02:00";
const PAST = "2020-01-01T00:00:00.000Z";
const LATER = "2027-01-15T08:00:00.000Z";

const DRAFT_ONLY: PermissionWorld = {
  roles: [],
  direct: [{ module: "communications", key: "campaigns.draft" }],
};

function role(name: string): PermissionWorld {
  return { roles: [{ id: "r", name }], direct: [] };
}

function perms(...keys: string[]): PermissionWorld {
  return {
    roles: [],
    direct: keys.map((key) => ({ module: "communications", key })),
  };
}

function world(access: PermissionWorld, user: { id: string } | null = { id: "me" }) {
  state.fake = createFakeSupabase({
    user,
    resolve: (q: FakeQuery) => permissionWorldResolver(access)(q) ?? { data: [] },
  });
}

function draftCampaign(overrides: Partial<NonNullable<typeof state.campaign>> = {}) {
  state.campaign = {
    id: "c1",
    status: "draft",
    scheduled_at: null,
    name: "Draft",
    subject: "Hello",
    preview_text: null,
    sending_identity_id: "ident-1",
    ...overrides,
  };
}

const call = (body: unknown) =>
  PATCH(
    new Request("http://x/api/campaigns/c1", {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "c1" }) }
  );

describe("PATCH /api/campaigns/[id] schedule permission", () => {
  beforeEach(() => {
    state.updates = [];
    state.labels = [];
    state.contacts = [];
    state.deletes = [];
    state.conflict = false;
    state.deleteMiss = false;
    draftCampaign();
    world(DRAFT_ONLY);
  });

  it("401 when not signed in", async () => {
    world(DRAFT_ONLY, null);
    expect((await call({ name: "Renamed" })).status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("403 when the caller cannot manage comms", async () => {
    world(role("staff"));
    expect((await call({ name: "Renamed" })).status).toBe(403);
    const res = await call({ status: "scheduled", scheduled_at: FUTURE });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not authorized");
    expect(state.updates).toEqual([]);
  });

  it("campaigns.send alone cannot patch — it is not a manage permission", async () => {
    world(perms("campaigns.send"));
    const res = await call({ status: "scheduled", scheduled_at: FUTURE });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not authorized");
    expect(state.updates).toEqual([]);
  });

  it("a draft-only user can still edit draft content", async () => {
    const res = await call({
      name: "  Renamed  ",
      subject: "Subject",
      preview_text: "Preview",
      sending_identity_id: "ident-2",
      body_source: { version: 1, blocks: [{ id: "b1", type: "text", text: "Hello" }] },
      label_ids: ["lab-1"],
      contact_ids: ["con-1"],
    });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].patch).toMatchObject({
      name: "Renamed",
      subject: "Subject",
      preview_text: "Preview",
      sending_identity_id: "ident-2",
    });
    expect(typeof state.updates[0].patch.body_html).toBe("string");
    expect(state.updates[0].patch.status).toBeUndefined();
    expect(state.updates[0].options).toEqual({ onlyStatuses: ["draft", "scheduled"] });
    expect(state.labels).toEqual([["lab-1"]]);
    expect(state.contacts).toEqual([["con-1"]]);
  });

  it("a draft-only user cannot schedule a send", async () => {
    const res = await call({
      status: "scheduled",
      scheduled_at: FUTURE,
      name: "Sneak",
      label_ids: ["lab-1"],
      contact_ids: ["con-1"],
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not authorized to schedule a send");
    expect(state.updates).toEqual([]);
    expect(state.labels).toEqual([]);
    expect(state.contacts).toEqual([]);
  });

  it("writing only scheduled_at on a draft does not arm cron, so draft-only may save it", async () => {
    const res = await call({ scheduled_at: PAST });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toEqual({ scheduled_at: PAST });
  });

  it("a pre-set scheduled_at still cannot be armed by flipping status", async () => {
    draftCampaign({ scheduled_at: PAST });
    const res = await call({ status: "scheduled" });
    expect(res.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("a draft-only user cannot move scheduled_at on a campaign cron would send", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    expect((await call({ scheduled_at: PAST })).status).toBe(403);
    expect((await call({ scheduled_at: LATER })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("the same instant in another format is not a reschedule", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    const res = await call({ scheduled_at: FUTURE_SAME_INSTANT });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toEqual({ scheduled_at: FUTURE_SAME_INSTANT });
  });

  it("a draft-only user cannot change what a scheduled campaign will send", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    const bodies = [
      { name: "Renamed" },
      { subject: "Swapped subject" },
      { preview_text: "Peek" },
      { sending_identity_id: "ident-2" },
      { body_source: { version: 1, blocks: [{ id: "b1", type: "text", text: "Swap" }] } },
      { label_ids: ["lab-9"] },
      { contact_ids: ["con-9"] },
    ];
    for (const body of bodies) {
      const res = await call(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect((await res.json()).error).toBe("Not authorized to edit a scheduled send");
    }
    expect(state.updates).toEqual([]);
    expect(state.labels).toEqual([]);
    expect(state.contacts).toEqual([]);
  });

  it("a sender can edit a scheduled campaign, and unscheduling stays on the draft gate", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    world(perms("campaigns.draft", "campaigns.send"));
    expect((await call({ subject: "Still scheduled", label_ids: ["lab-1"] })).status).toBe(200);
    expect(state.labels).toEqual([["lab-1"]]);

    world(DRAFT_ONLY);
    state.updates = [];
    state.labels = [];
    const res = await call({ status: "draft", subject: "Pulled back" });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toMatchObject({ status: "draft", subject: "Pulled back" });
  });

  it("409 when the row is no longer draft or scheduled", async () => {
    state.conflict = true;
    const res = await call({ subject: "Too late", label_ids: ["lab-1"], contact_ids: ["con-1"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Campaign can no longer be edited");
    expect(state.updates[0].options).toEqual({ onlyStatuses: ["draft", "scheduled"] });
    expect(state.labels).toEqual([]);
    expect(state.contacts).toEqual([]);
  });

  it("clearing scheduled_at on a scheduled campaign does not arm cron", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    const res = await call({ scheduled_at: null });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toEqual({ scheduled_at: null });
  });

  it("a draft-only user can unschedule back to draft", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    const res = await call({ status: "draft" });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toEqual({ status: "draft" });
  });

  it("rejects status values the cron or send-now own, and unknown values", async () => {
    for (const status of ["sending", "sent", "failed", "cancelled", "queued"]) {
      const res = await call({ status });
      expect(res.status, status).toBe(400);
    }
    expect((await call({ status: "sending" })).status).toBe(400);
    const unknown = await call({ status: "queued" });
    expect((await unknown.json()).error).toBe("Unknown campaign status");
    const jump = await call({ status: "sent" });
    expect((await jump.json()).error).toBe(
      "Cannot change campaign status from draft to sent"
    );
    expect((await call({ status: null })).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("rejects an unparsable scheduled_at before any write", async () => {
    world(role("comms_admin"));
    for (const scheduled_at of ["tomorrow", "", "1", "2026-12-01", 123, {}]) {
      expect((await call({ scheduled_at })).status).toBe(400);
    }
    expect(state.updates).toEqual([]);
  });

  it.each(["super_admin", "admin", "comms_admin"])(
    "%s can schedule, same as send-now",
    async (name) => {
      world(role(name));
      const res = await call({ status: "scheduled", scheduled_at: FUTURE });
      expect(res.status).toBe(200);
      expect(state.updates[0].patch).toEqual({
        status: "scheduled",
        scheduled_at: FUTURE,
      });
    }
  );

  it.each(["communications.send_emails", "communications.send_announcements"])(
    "%s can schedule",
    async (key) => {
      world(perms(key));
      const res = await call({ status: "scheduled", scheduled_at: FUTURE });
      expect(res.status).toBe(200);
      expect(state.updates[0].patch.status).toBe("scheduled");
    }
  );

  it("campaigns.draft plus campaigns.send can schedule", async () => {
    world(perms("campaigns.draft", "campaigns.send"));
    const res = await call({ status: "scheduled", scheduled_at: FUTURE });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toMatchObject({
      status: "scheduled",
      scheduled_at: FUTURE,
    });
  });

  it("manage_templates can edit a draft but cannot schedule", async () => {
    world(perms("communications.manage_templates"));
    expect((await call({ subject: "Still a draft" })).status).toBe(200);
    state.updates = [];
    const res = await call({ status: "scheduled", scheduled_at: FUTURE });
    expect(res.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("404 when the campaign is missing and 409 once it has started sending", async () => {
    state.campaign = null;
    expect((await call({ name: "x" })).status).toBe(404);
    draftCampaign({ status: "sent" });
    expect((await call({ name: "x" })).status).toBe(409);
    draftCampaign({ status: "sending" });
    expect((await call({ status: "draft" })).status).toBe(409);
    expect(state.updates).toEqual([]);
  });

  it("400 on invalid JSON and on an empty patch", async () => {
    expect((await call("{")).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(state.updates).toEqual([]);
  });
});

const getCall = () =>
  GET(new Request("http://x/api/campaigns/c1"), {
    params: Promise.resolve({ id: "c1" }),
  });

describe("GET /api/campaigns/[id] read gate", () => {
  beforeEach(() => {
    draftCampaign();
    world(DRAFT_ONLY);
  });

  it("401 when not signed in", async () => {
    world(DRAFT_ONLY, null);
    expect((await getCall()).status).toBe(401);
  });

  it("403 for a signed-in student or staff member with no communications access", async () => {
    world(role("student"));
    expect((await getCall()).status).toBe(403);
    world({
      roles: [{ id: "r-staff", name: "staff" }],
      direct: [{ module: "events", key: "events.create" }],
    });
    const res = await getCall();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not authorized");
  });

  it("allows a communications-module permission such as campaigns.read", async () => {
    world(perms("campaigns.read"));
    const res = await getCall();
    expect(res.status).toBe(200);
    expect((await res.json()).campaign.id).toBe("c1");
  });

  it("allows other communications-module permissions and a role bundle", async () => {
    world(perms("forms.read"));
    expect((await getCall()).status).toBe(200);
    world({
      roles: [{ id: "r-staff", name: "staff" }],
      direct: [],
      bundles: { "r-staff": [{ module: "communications", key: "campaigns.read" }] },
    });
    expect((await getCall()).status).toBe(200);
  });

  it.each(["super_admin", "admin", "comms_admin"])("%s can read", async (name) => {
    world(role(name));
    expect((await getCall()).status).toBe(200);
  });

  it("404 when an allowed reader asks for a missing campaign", async () => {
    world(role("comms_admin"));
    state.campaign = null;
    expect((await getCall()).status).toBe(404);
  });
});

const deleteCall = () =>
  DELETE(new Request("http://x/api/campaigns/c1", { method: "DELETE" }), {
    params: Promise.resolve({ id: "c1" }),
  });

describe("DELETE /api/campaigns/[id]", () => {
  beforeEach(() => {
    state.deletes = [];
    state.deleteMiss = false;
    draftCampaign();
    world(DRAFT_ONLY);
  });

  it("a draft-only user can delete a draft", async () => {
    const res = await deleteCall();
    expect(res.status).toBe(200);
    expect(state.deletes[0].options).toEqual({ onlyStatuses: ["draft"] });
  });

  it("a draft-only user cannot delete a scheduled campaign", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    const res = await deleteCall();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not authorized to delete a scheduled send");
    expect(state.deletes).toEqual([]);
  });

  it("a sender can delete a scheduled campaign, still conditioned on that status", async () => {
    draftCampaign({ status: "scheduled", scheduled_at: FUTURE });
    world(perms("campaigns.draft", "campaigns.send"));
    expect((await deleteCall()).status).toBe(200);
    expect(state.deletes[0].options).toEqual({ onlyStatuses: ["scheduled"] });
  });

  it("409 when the row's status changed before the delete", async () => {
    state.deleteMiss = true;
    const res = await deleteCall();
    expect(res.status).toBe(409);
    expect(state.deletes).toHaveLength(1);
  });
});
