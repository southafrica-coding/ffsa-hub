import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemorySupabase, type MemRow } from "@/lib/testing/memory-supabase";
import type { XeroMirrorSource } from "@/services/xero";
import {
  mirrorStatus,
  planMirror,
  planProjects,
  planRoleLink,
  syncXeroMirror,
  syncXeroRegion,
  type OptionRow,
  type ProjectRow,
} from "./xero-mirror-sync";

// The sync runs against an in-memory copy of the tables, with Xero replaced
// by a fixed answer (or, in the last block, by a fetch spy behind the real
// Xero client). Nothing here talks to Xero or Supabase.

const key = (name: string) => name.trim().toLowerCase();
const MIRROR = ["xero_accounts", "xero_tracking_categories", "xero_tracking_options", "xero_items"];

function db(extra: Record<string, MemRow[]> = {}) {
  const mirrorDefaults = { missing_since: null, status: "active", friendly_name: null, is_hidden: false };
  return createMemorySupabase(
    {
      finance_orgs: [
        { id: "org-npc", key: "npc", name: "FFSA NPC", xero_region: "za", projects_category_name: "Ministries" },
        { id: "org-usa", key: "usa", name: "FF USA Inc", xero_region: "us", projects_category_name: "Ministries" },
      ],
      finance_projects: [
        // From the 290 CSV seed: not linked to Xero yet.
        { id: "p-glory", org_id: "org-npc", name: "Glory", sort_order: 1, project_type: "event", notes: "keep me", linked_project_id: "p-us-glory", is_active: true, archived_at: null, xero_tracking_option_id: null, source: "xero_csv_2026-11-05" },
        { id: "p-tanz", org_id: "org-npc", name: "efltanz ", sort_order: 2, project_type: null, notes: null, linked_project_id: null, is_active: true, archived_at: null, xero_tracking_option_id: null, source: "xero_csv_2026-11-05" },
        { id: "p-gone", org_id: "org-npc", name: "Gone Project", sort_order: 3, project_type: "asset", notes: null, linked_project_id: null, is_active: true, archived_at: null, xero_tracking_option_id: null, source: "xero_csv_2026-11-05" },
        { id: "p-us-glory", org_id: "org-usa", name: "Glory", sort_order: 1, project_type: null, notes: null, linked_project_id: "p-glory", is_active: true, archived_at: null, xero_tracking_option_id: null, source: "xero_csv_2026-11-05" },
      ],
      xero_tracking_roles: [
        { role_key: "schools", org_region: "za", category_name: "Schools", category_id: null },
        { role_key: "schools", org_region: "us", category_name: "Schools", category_id: null },
        { role_key: "ministries", org_region: "za", category_name: "Ministries", category_id: null },
        { role_key: "ministries", org_region: "us", category_name: "Ministries", category_id: null },
      ],
      xero_sync_runs: [],
      xero_mirror_changes: [],
      ...Object.fromEntries(MIRROR.map((t) => [t, []])),
      ...extra,
    },
    {
      defaults: {
        ...Object.fromEntries(MIRROR.map((t) => [t, mirrorDefaults])),
        finance_projects: { project_type: null, notes: null, linked_project_id: null, archived_at: null, is_active: true, xero_tracking_option_id: null },
        xero_sync_runs: { status: "running", counts: {}, error: null, finished_at: null, tenant_id: null },
      },
      generated: {
        xero_tracking_options: (r) => ({ match_key: key(r.name) }),
        finance_projects: (r) => ({ match_key: key(r.name) }),
      },
      unique: {
        xero_sync_runs: [{ cols: ["org_region"], where: (r) => r.status === "running" }],
        finance_projects: [
          { cols: ["org_id", "name"] },
          { cols: ["xero_tracking_option_id"], where: (r) => r.xero_tracking_option_id != null },
        ],
      },
    }
  );
}

type Opt = { id: string; name: string; status?: string };

function xero(ministries: Opt[], extra: Partial<Extract<XeroMirrorSource, { ok: true }>> = {}): XeroMirrorSource {
  return {
    ok: true,
    tenantId: "tenant-za",
    accounts: [
      { AccountID: "a-200", Code: "200", Name: "Sales", Type: "REVENUE", Class: "REVENUE", Status: "ACTIVE" },
      { AccountID: "a-090", Code: "090", Name: "FNB Cheque", Type: "BANK", Class: "ASSET", Status: "ACTIVE", CurrencyCode: "ZAR" },
      { AccountID: "a-old", Code: "999", Name: "Old Expense", Type: "EXPENSE", Class: "EXPENSE", Status: "ARCHIVED" },
    ],
    trackingCategories: [
      {
        TrackingCategoryID: "c-min",
        Name: "Ministries",
        Status: "ACTIVE",
        Options: ministries.map((o) => ({ TrackingOptionID: o.id, Name: o.name, Status: o.status ?? "ACTIVE" })),
      },
      {
        TrackingCategoryID: "c-sch",
        Name: "Schools",
        Status: "ACTIVE",
        Options: [{ TrackingOptionID: "o-dts", Name: "DTS", Status: "ACTIVE" }],
      },
    ],
    items: [{ ItemID: "i-1", Code: "REG", Name: "Registration", IsSold: true, IsPurchased: false, SalesDetails: { AccountCode: "200" } }],
    ...extra,
  };
}

const MINISTRIES: Opt[] = [
  { id: "o-glory", name: "Glory" },
  { id: "o-tanz", name: "EFLTanz" },
  { id: "o-new", name: "New Thing" },
  { id: "o-old", name: "Old Ministry", status: "ARCHIVED" },
];

/** za answers with `source`; us is not connected. */
function sourceFor(source: XeroMirrorSource) {
  return vi.fn(async (_db: unknown, region: string): Promise<XeroMirrorSource> =>
    region === "za" ? source : { ok: false, reason: "not_connected", message: "This organisation is not connected to Xero." }
  );
}

const project = (m: ReturnType<typeof db>, id: string) => m.tables.finance_projects.find((p) => p.id === id)!;
const option = (m: ReturnType<typeof db>, xeroId: string) => m.tables.xero_tracking_options.find((o) => o.xero_option_id === xeroId)!;

describe("syncXeroMirror — first sync", () => {
  it("mirrors the full chart, categories, options and items, and records a run per region", async () => {
    const m = db();
    const results = await syncXeroMirror(m.client, { trigger: "cron", fetchSource: sourceFor(xero(MINISTRIES)) });

    expect(results.map((r) => [r.region, r.status])).toEqual([["za", "succeeded"], ["us", "skipped"]]);
    expect(m.tables.xero_accounts).toHaveLength(3); // every type and status, archived included
    expect(m.tables.xero_accounts.find((a) => a.xero_account_id === "a-old")?.status).toBe("archived");
    expect(m.tables.xero_accounts.find((a) => a.xero_account_id === "a-090")?.is_bank).toBe(true);
    expect(m.tables.xero_tracking_categories).toHaveLength(2);
    expect(m.tables.xero_tracking_options).toHaveLength(5);
    expect(m.tables.xero_items).toHaveLength(1);
    for (const t of MIRROR) for (const r of m.tables[t]) expect([r.org_region, r.tenant_id]).toEqual(["za", "tenant-za"]);

    const runs = m.tables.xero_sync_runs;
    expect(runs.map((r) => [r.org_region, r.status, r.trigger])).toEqual([
      ["za", "succeeded", "cron"],
      ["us", "skipped", "cron"],
    ]);
    expect(runs[1].error).toMatch(/not connected/);
    expect(runs.every((r) => r.finished_at)).toBe(true);
  });

  it("matches seeded projects by name, links them, and adds Xero's new options untyped", async () => {
    const m = db();
    await syncXeroMirror(m.client, { trigger: "cron", fetchSource: sourceFor(xero(MINISTRIES)) });

    const glory = project(m, "p-glory");
    expect(glory.xero_tracking_option_id).toBe(option(m, "o-glory").id);
    // Hub-owned fields are untouched.
    expect([glory.project_type, glory.notes, glory.linked_project_id]).toEqual(["event", "keep me", "p-us-glory"]);

    // Case/space-insensitive match, then the name takes Xero's spelling.
    const tanz = project(m, "p-tanz");
    expect(tanz.xero_tracking_option_id).toBe(option(m, "o-tanz").id);
    expect(tanz.name).toBe("EFLTanz");

    const added = m.tables.finance_projects.find((p) => p.name === "New Thing")!;
    expect(added).toMatchObject({
      org_id: "org-npc",
      source: "xero_sync",
      project_type: null,
      linked_project_id: null,
      is_active: true,
      sort_order: 4,
      xero_tracking_option_id: option(m, "o-new").id,
    });

    // An option already archived in Xero is not added as a new project.
    expect(m.tables.finance_projects.some((p) => p.name === "Old Ministry")).toBe(false);
  });

  it("archives a seeded project Xero doesn't have, never deletes, and never touches the other org", async () => {
    const m = db();
    await syncXeroMirror(m.client, { trigger: "cron", fetchSource: sourceFor(xero(MINISTRIES)) });

    expect(project(m, "p-gone")).toMatchObject({ is_active: false, project_type: "asset" });
    expect(project(m, "p-gone").archived_at).toBeTruthy();
    expect(m.tables.finance_projects).toHaveLength(5); // 4 seeded + New Thing
    // Same name in FF USA Inc: not linked, not renamed, not archived (us not connected).
    expect(project(m, "p-us-glory")).toMatchObject({ xero_tracking_option_id: null, is_active: true, name: "Glory" });
  });

  it("fills the schools and ministries roles for the synced region only", async () => {
    const m = db();
    await syncXeroMirror(m.client, { trigger: "cron", fetchSource: sourceFor(xero(MINISTRIES)) });
    const cat = (x: string) => m.tables.xero_tracking_categories.find((c) => c.xero_category_id === x)!.id;
    const role = (k: string, r: string) => m.tables.xero_tracking_roles.find((x) => x.role_key === k && x.org_region === r)!;
    expect(role("schools", "za").category_id).toBe(cat("c-sch"));
    expect(role("ministries", "za").category_id).toBe(cat("c-min"));
    expect(role("schools", "us").category_id).toBeNull();
    expect(role("ministries", "us").category_id).toBeNull();
  });
});

describe("syncXeroMirror — later syncs", () => {
  async function synced() {
    const m = db();
    await syncXeroMirror(m.client, { trigger: "cron", fetchSource: sourceFor(xero(MINISTRIES)) });
    // finance edits Hub-owned fields on the mirror
    Object.assign(option(m, "o-glory"), { friendly_name: "Glory (conf)", is_hidden: true });
    Object.assign(m.tables.xero_accounts.find((a) => a.xero_account_id === "a-200")!, { friendly_name: "Ticket sales", is_hidden: true });
    return m;
  }

  it("a Xero rename updates the same project's name and logs the change; Hub fields survive", async () => {
    const m = await synced();
    const renamed = MINISTRIES.map((o) => (o.id === "o-glory" ? { ...o, name: "Glory Conference" } : o));
    const before = m.tables.finance_projects.length;
    const [za] = await syncXeroMirror(m.client, { trigger: "view", regions: ["za"], fetchSource: sourceFor(xero(renamed)) });

    expect(za.status).toBe("succeeded");
    expect(m.tables.finance_projects).toHaveLength(before);
    expect(project(m, "p-glory")).toMatchObject({ name: "Glory Conference", project_type: "event", notes: "keep me", linked_project_id: "p-us-glory" });
    expect(option(m, "o-glory")).toMatchObject({ name: "Glory Conference", friendly_name: "Glory (conf)", is_hidden: true });
    expect(m.tables.xero_accounts.find((a) => a.xero_account_id === "a-200")).toMatchObject({ friendly_name: "Ticket sales", is_hidden: true });

    const change = m.tables.xero_mirror_changes.find((c) => c.field === "name");
    expect(change).toMatchObject({
      entity: "tracking_option",
      entity_id: option(m, "o-glory").id,
      old_value: "Glory",
      new_value: "Glory Conference",
      run_id: za.runId,
      org_region: "za",
    });
  });

  it("an account code change and an archive in Xero are mirrored and logged", async () => {
    const m = await synced();
    const src = xero(MINISTRIES);
    if (!src.ok) throw new Error();
    src.accounts[0] = { ...src.accounts[0], Code: "201" };
    src.accounts[1] = { ...src.accounts[1], Status: "ARCHIVED" };
    await syncXeroMirror(m.client, { trigger: "cron", regions: ["za"], fetchSource: sourceFor(src) });

    const fields = m.tables.xero_mirror_changes.filter((c) => c.entity === "account").map((c) => [c.field, c.old_value, c.new_value]);
    expect(fields).toEqual(expect.arrayContaining([["code", "200", "201"], ["status", "active", "archived"]]));
    expect(m.tables.xero_accounts).toHaveLength(3);
  });

  it("an option Xero stops returning is marked missing and its project archived, not deleted; it comes back cleanly", async () => {
    const m = await synced();
    const without = MINISTRIES.filter((o) => o.id !== "o-new");
    await syncXeroMirror(m.client, { trigger: "cron", regions: ["za"], fetchSource: sourceFor(xero(without)) });

    expect(option(m, "o-new").missing_since).toBeTruthy();
    const added = m.tables.finance_projects.find((p) => p.name === "New Thing")!;
    expect(added.is_active).toBe(false);
    expect(m.tables.xero_mirror_changes.some((c) => c.field === "missing" && c.entity_id === option(m, "o-new").id)).toBe(true);

    await syncXeroMirror(m.client, { trigger: "cron", regions: ["za"], fetchSource: sourceFor(xero(MINISTRIES)) });
    expect(option(m, "o-new").missing_since).toBeNull();
    expect(m.tables.finance_projects.find((p) => p.id === added.id)).toMatchObject({ is_active: true, archived_at: null });
  });

  it("an option archived in Xero archives its project", async () => {
    const m = await synced();
    const archived = MINISTRIES.map((o) => (o.id === "o-glory" ? { ...o, status: "ARCHIVED" } : o));
    await syncXeroMirror(m.client, { trigger: "cron", regions: ["za"], fetchSource: sourceFor(xero(archived)) });
    expect(option(m, "o-glory").status).toBe("archived");
    expect(project(m, "p-glory")).toMatchObject({ is_active: false, project_type: "event" });
  });

  it("an empty Ministries list from Xero archives nothing and says so", async () => {
    const m = await synced();
    const [za] = await syncXeroMirror(m.client, { trigger: "cron", regions: ["za"], fetchSource: sourceFor(xero([])) });
    expect(za.status).toBe("partial");
    expect(za.error).toMatch(/left as they are/);
    expect(m.tables.finance_projects.filter((p) => p.org_id === "org-npc" && p.is_active)).toHaveLength(3);
  });

  it("leaves an admin's deliberate role remapping alone", async () => {
    const m = await synced();
    const schools = m.tables.xero_tracking_categories.find((c) => c.xero_category_id === "c-sch")!;
    const role = m.tables.xero_tracking_roles.find((r) => r.role_key === "ministries" && r.org_region === "za")!;
    role.category_id = schools.id; // admin points 'ministries' at Schools on purpose
    await syncXeroMirror(m.client, { trigger: "cron", regions: ["za"], fetchSource: sourceFor(xero(MINISTRIES)) });
    expect(role.category_id).toBe(schools.id);
  });
});

describe("syncXeroMirror — regions, locks, freshness", () => {
  it("one region failing never stops the other", async () => {
    const m = db();
    const fetchSource = vi.fn(async (_db: unknown, region: string): Promise<XeroMirrorSource> => {
      if (region === "za") throw new Error("boom");
      return { ...xero([{ id: "u-glory", name: "Glory" }]), tenantId: "tenant-us" } as XeroMirrorSource;
    });
    const results = await syncXeroMirror(m.client, { trigger: "cron", fetchSource });
    expect(results.map((r) => [r.region, r.status])).toEqual([["za", "failed"], ["us", "succeeded"]]);
    expect(project(m, "p-us-glory").xero_tracking_option_id).toBeTruthy();
    expect(project(m, "p-glory").xero_tracking_option_id).toBeNull();
  });

  it("an expired authorisation is a failed run with a plain reason", async () => {
    const m = db();
    const fetchSource = vi.fn(async (): Promise<XeroMirrorSource> => ({
      ok: false,
      reason: "token",
      tenantId: "tenant-za",
      message: "Xero would not renew the saved authorisation. Reconnect this organisation.",
    }));
    const [za] = await syncXeroMirror(m.client, { trigger: "view", regions: ["za"], fetchSource });
    expect(za.status).toBe("failed");
    expect(m.tables.xero_sync_runs[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/Reconnect/) });
    expect(m.tables.finance_projects.every((p) => p.is_active)).toBe(true);
  });

  it("does not start a second sync for a region that is already running", async () => {
    const m = db({
      xero_sync_runs: [{ id: "r1", org_region: "za", status: "running", trigger: "cron", kind: "all", started_at: new Date().toISOString() }],
    });
    const fetchSource = sourceFor(xero(MINISTRIES));
    expect((await syncXeroRegion(m.client, "za", { trigger: "view", fetchSource })).status).toBe("busy");
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("closes a run that died mid-way and carries on", async () => {
    const m = db({
      xero_sync_runs: [{ id: "r1", org_region: "za", status: "running", trigger: "cron", kind: "all", started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }],
    });
    const r = await syncXeroRegion(m.client, "za", { trigger: "view", fetchSource: sourceFor(xero(MINISTRIES)) });
    expect(r.status).toBe("succeeded");
    expect(m.tables.xero_sync_runs[0].status).toBe("failed");
  });

  it("with maxAgeMs, a recently synced region is left alone", async () => {
    const m = db({
      xero_sync_runs: [{ id: "r1", org_region: "za", status: "succeeded", trigger: "cron", kind: "all", started_at: new Date().toISOString() }],
    });
    const fetchSource = sourceFor(xero(MINISTRIES));
    const results = await syncXeroMirror(m.client, { trigger: "view", maxAgeMs: 5 * 60 * 1000, fetchSource });
    expect(results.map((r) => [r.region, r.status])).toEqual([["za", "fresh"], ["us", "skipped"]]);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource).toHaveBeenCalledWith(expect.anything(), "us");
  });
});

describe("syncXeroMirror — read-only toward Xero", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only ever sends GET requests to Xero", async () => {
    const m = db({
      xero_tokens: [
        { id: "t1", region: "za", tenant_id: "tenant-za", access_token: "a", refresh_token: "r", expires_at: new Date(Date.now() + 3600e3).toISOString(), updated_at: "2026-11-06" },
      ],
    });
    const src = xero(MINISTRIES);
    if (!src.ok) throw new Error();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const body = url.includes("/Accounts")
        ? { Accounts: src.accounts }
        : url.includes("/TrackingCategories")
          ? { TrackingCategories: src.trackingCategories }
          : { Items: src.items };
      void init;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const results = await syncXeroMirror(m.client, { trigger: "cron" });
    expect(results.map((r) => [r.region, r.status])).toEqual([["za", "succeeded"], ["us", "skipped"]]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchSpy.mock.calls) {
      expect(url).toMatch(/^https:\/\/api\.xero\.com\/api\.xro\/2\.0\/(Accounts|TrackingCategories\?includeArchived=true|Items)$/);
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
    }
    expect(m.tables.finance_projects.find((p) => p.name === "New Thing")).toBeTruthy();
  });
});

// ── Planners on their own ───────────────────────────────────

describe("planners", () => {
  const now = "2026-11-06T08:00:00.000Z";

  it("maps Xero status onto active / archived", () => {
    expect(mirrorStatus("ACTIVE")).toBe("active");
    expect(mirrorStatus(undefined)).toBe("active");
    expect(mirrorStatus("ARCHIVED")).toBe("archived");
    expect(mirrorStatus("DELETED")).toBe("archived");
  });

  it("planMirror: rows under an old tenant go missing; the new tenant's are added beside them", () => {
    const existing = [{ id: "x1", tenant_id: "old", xero_option_id: "o1", name: "A", status: "active", category_id: "c", missing_since: null }];
    const plan = planMirror("tracking_option", existing, [{ xero_id: "o1", name: "A", status: "active", category_id: "c" }], "new", now);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.missing.map((x) => x.id)).toEqual(["x1"]);
  });

  it("planProjects: an option link wins over a name match", () => {
    const projects: ProjectRow[] = [
      { id: "linked", org_id: "o", name: "Old Name", sort_order: 1, is_active: true, archived_at: null, xero_tracking_option_id: "opt" },
      { id: "byname", org_id: "o", name: "Other", sort_order: 2, is_active: true, archived_at: null, xero_tracking_option_id: null },
    ];
    const options: OptionRow[] = [{ id: "opt", name: "Other", status: "active", missing_since: null }];
    const plan = planProjects("o", projects, options, now);
    expect(plan.updates.find((u) => u.id === "linked")).toMatchObject({ patch: { name: "Other" }, kind: ["renamed"] });
    // The unlinked same-name row is not Xero's: archived, not linked.
    expect(plan.updates.find((u) => u.id === "byname")).toMatchObject({ kind: ["archived"] });
    expect(plan.inserts).toEqual([]);
  });

  it("planProjects: never considers projects in another org", () => {
    const projects: ProjectRow[] = [
      { id: "other-org", org_id: "usa", name: "Glory", sort_order: 1, is_active: true, archived_at: null, xero_tracking_option_id: null },
    ];
    const plan = planProjects("npc", projects, [{ id: "opt", name: "Glory", status: "active", missing_since: null }], now);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toMatchObject([{ org_id: "npc", name: "Glory", source: "xero_sync" }]);
  });

  it("planRoleLink: fills NULL, follows a same-name category, leaves a remap alone", () => {
    const cats = [
      { id: "new-min", tenant_id: "t", name: "Ministries", missing_since: null },
      { id: "old-min", tenant_id: "old", name: "ministries", missing_since: now },
      { id: "sch", tenant_id: "t", name: "Schools", missing_since: null },
    ];
    expect(planRoleLink({ category_name: "Ministries", category_id: null }, cats, "t")).toBe("new-min");
    expect(planRoleLink({ category_name: "Ministries", category_id: "old-min" }, cats, "t")).toBe("new-min");
    expect(planRoleLink({ category_name: "Ministries", category_id: "sch" }, cats, "t")).toBeNull();
    expect(planRoleLink({ category_name: "Ministries", category_id: "new-min" }, cats, "t")).toBeNull();
  });
});
