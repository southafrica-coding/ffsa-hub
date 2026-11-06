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
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  labels: [] as string[][],
  contacts: [] as string[][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));
vi.mock("@/services/campaigns", () => ({
  getCampaignById: async () => ({ data: state.campaign, error: null }),
  updateCampaign: async (_s: unknown, id: string, patch: Record<string, unknown>) => {
    state.updates.push({ id, patch });
    return { data: { id, ...patch }, error: null };
  },
  deleteCampaign: async () => ({ error: null }),
  setCampaignLabels: async (_s: unknown, _id: string, labelIds: string[]) => {
    state.labels.push(labelIds);
    return { error: null };
  },
  setCampaignContacts: async (_s: unknown, _id: string, contactIds: string[]) => {
    state.contacts.push(contactIds);
    return { error: null };
  },
}));

import { PATCH } from "./route";

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
    const res = await call({ scheduled_at: FUTURE_SAME_INSTANT, name: "Copy edit" });
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toMatchObject({
      scheduled_at: FUTURE_SAME_INSTANT,
      name: "Copy edit",
    });
    expect(state.updates[0].patch.status).toBeUndefined();
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
    for (const scheduled_at of ["tomorrow", "", 123, {}]) {
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
