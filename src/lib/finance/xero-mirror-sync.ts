/**
 * Keeps the Hub in step with both Xero files (migrations 275, 290, 291).
 *
 * For each organisation ('za' = FFSA NPC, 'us' = FF USA Inc) it reads the
 * chart of accounts, the tracking categories with their options, and the
 * items from Xero, and mirrors them into xero_accounts /
 * xero_tracking_categories / xero_tracking_options / xero_items. Then it
 * brings finance_projects (the Hub's projects) in line with that org's
 * "Ministries" options.
 *
 * Xero is the source of truth for names and status. The Hub owns
 * friendly_name / is_hidden on the mirror and project_type / notes /
 * linked_project_id on projects; the sync never writes those.
 *
 * Read-only toward Xero: the only Xero call is fetchXeroMirrorSource (three
 * GETs). Writes go to the Hub database with the service role, so callers
 * must pass createAdminClient() — never a browser session.
 *
 * Nothing is ever deleted. A row Xero stops returning gets missing_since; a
 * project whose option is gone or archived is archived (is_active = false).
 *
 * One region failing (not connected, token lapsed, Xero down) records its own
 * xero_sync_runs row and never stops the other region.
 */

import { fetchXeroMirrorSource, type XeroMirrorSource, type XeroRegion } from "@/services/xero";
import type { XeroMirrorFreshness } from "./xero-freshness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const XERO_REGIONS: XeroRegion[] = ["za", "us"];
export type XeroSyncTrigger = "cron" | "manual" | "view" | "reconnect";

/** A page view refreshes the mirror when the last attempt is older than this. */
export const XERO_MIRROR_MAX_AGE_MS = 5 * 60 * 1000;
/** A run still "running" after this long died mid-way; it is closed as failed. */
const STALE_RUN_MS = 10 * 60 * 1000;
const ID_CHUNK = 100;

const REGION_TO_ORG_KEY: Record<XeroRegion, "npc" | "usa"> = { za: "npc", us: "usa" };

// ────────────────────────────────────────────────────────────
// Xero → mirror row shapes
// ────────────────────────────────────────────────────────────

type Entity = "account" | "tracking_category" | "tracking_option" | "item";

type EntityConfig = {
  table: string;
  xeroIdColumn: string;
  /** Columns that come from Xero and are diffed (and logged when they change). */
  fields: string[];
};

const ENTITIES: Record<Entity, EntityConfig> = {
  account: {
    table: "xero_accounts",
    xeroIdColumn: "xero_account_id",
    fields: ["code", "name", "type", "class", "tax_type", "is_bank", "currency_code", "description", "status"],
  },
  tracking_category: {
    table: "xero_tracking_categories",
    xeroIdColumn: "xero_category_id",
    fields: ["name", "status"],
  },
  tracking_option: {
    table: "xero_tracking_options",
    xeroIdColumn: "xero_option_id",
    fields: ["category_id", "name", "status"],
  },
  item: {
    table: "xero_items",
    xeroIdColumn: "xero_item_id",
    fields: ["code", "name", "description", "sales_account_code", "is_sold", "is_purchased", "status"],
  },
};

/** Xero's ACTIVE / ARCHIVED / DELETED → the mirror's active / archived. */
export function mirrorStatus(xeroStatus: unknown): "active" | "archived" {
  return xeroStatus === undefined || xeroStatus === null || xeroStatus === "ACTIVE" ? "active" : "archived";
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function accountFromXero(a: any): Row {
  return {
    xero_id: a.AccountID,
    code: str(a.Code),
    name: str(a.Name) ?? "(no name)",
    type: str(a.Type),
    class: str(a.Class),
    tax_type: str(a.TaxType),
    is_bank: a.Type === "BANK",
    currency_code: str(a.CurrencyCode),
    description: str(a.Description),
    status: mirrorStatus(a.Status),
    raw: a,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function categoryFromXero(c: any): Row {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { Options, ...raw } = c;
  return { xero_id: c.TrackingCategoryID, name: str(c.Name) ?? "(no name)", status: mirrorStatus(c.Status), raw };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function optionFromXero(o: any, categoryId: string): Row {
  return {
    xero_id: o.TrackingOptionID,
    category_id: categoryId,
    name: str(o.Name) ?? "(no name)",
    status: mirrorStatus(o.Status),
    raw: o,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemFromXero(i: any): Row {
  return {
    xero_id: i.ItemID,
    code: str(i.Code),
    name: str(i.Name),
    description: str(i.Description),
    sales_account_code: str(i.SalesDetails?.AccountCode),
    is_sold: typeof i.IsSold === "boolean" ? i.IsSold : null,
    is_purchased: typeof i.IsPurchased === "boolean" ? i.IsPurchased : null,
    status: "active",
    raw: i,
  };
}

// ────────────────────────────────────────────────────────────
// Planning (pure): what to insert, update, touch, mark missing
// ────────────────────────────────────────────────────────────

export type FieldChange = { field: string; old_value: string | null; new_value: string | null };

export type MirrorPlan = {
  inserts: Row[];
  updates: Array<{ id: string; patch: Row; changes: FieldChange[] }>;
  /** Seen in Xero, nothing changed: only synced_at moves. */
  unchanged: string[];
  /** Was there, Xero no longer returns it (or it belongs to an old tenant). */
  missing: Array<{ id: string; changes: FieldChange[] }>;
};

const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Compares what the mirror holds for one region with what Xero just
 * returned. `existing` is every mirror row for the region (any tenant);
 * rows under another tenant are the old organisation and go missing.
 */
export function planMirror(
  entity: Entity,
  existing: Row[],
  incoming: Row[],
  tenantId: string,
  now: string
): MirrorPlan {
  const cfg = ENTITIES[entity];
  const byXeroId = new Map(
    existing.filter((r) => r.tenant_id === tenantId).map((r) => [r[cfg.xeroIdColumn] as string, r])
  );
  const plan: MirrorPlan = { inserts: [], updates: [], unchanged: [], missing: [] };
  const seen = new Set<string>();

  for (const inc of incoming) {
    if (!inc.xero_id || seen.has(inc.xero_id)) continue;
    seen.add(inc.xero_id);
    const cur = byXeroId.get(inc.xero_id);
    if (!cur) {
      plan.inserts.push(inc);
      continue;
    }
    const changes: FieldChange[] = [];
    const patch: Row = {};
    for (const f of cfg.fields) {
      if ((cur[f] ?? null) !== (inc[f] ?? null)) {
        patch[f] = inc[f] ?? null;
        changes.push({ field: f, old_value: asText(cur[f]), new_value: asText(inc[f]) });
      }
    }
    if (cur.missing_since) {
      patch.missing_since = null;
      changes.push({ field: "missing", old_value: asText(cur.missing_since), new_value: null });
    }
    if (changes.length > 0) {
      plan.updates.push({ id: cur.id, patch: { ...patch, raw: inc.raw, last_changed_at: now }, changes });
    } else {
      plan.unchanged.push(cur.id);
    }
  }

  for (const r of existing) {
    const current = r.tenant_id === tenantId && seen.has(r[cfg.xeroIdColumn]);
    if (current || r.missing_since) continue;
    plan.missing.push({ id: r.id, changes: [{ field: "missing", old_value: null, new_value: now }] });
  }
  return plan;
}

export type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  match_key?: string | null;
  sort_order: number | null;
  is_active: boolean;
  archived_at: string | null;
  xero_tracking_option_id: string | null;
};

export type OptionRow = {
  id: string;
  name: string;
  status: string;
  missing_since: string | null;
};

export type ProjectPlan = {
  inserts: Row[];
  updates: Array<{ id: string; patch: Row; kind: Array<"linked" | "renamed" | "archived" | "reactivated"> }>;
};

const matchKey = (name: string) => name.trim().toLowerCase();

/**
 * Brings one org's projects in line with its Ministries options.
 *
 * Match an option to a project by the option link first, else by name
 * (case/space-insensitive) among projects not yet linked to an option. Same
 * org only: projects in the other org are never considered.
 * Never touches project_type, notes or linked_project_id. Never deletes.
 *
 * Projects Xero no longer has are archived — but only when the category came
 * back with at least one live option, so a Xero hiccup that returns an empty
 * category can't archive the whole list.
 */
export function planProjects(
  orgId: string,
  projects: ProjectRow[],
  options: OptionRow[],
  now: string
): ProjectPlan {
  const plan: ProjectPlan = { inserts: [], updates: [] };
  const own = projects.filter((p) => p.org_id === orgId);
  const byOption = new Map(own.filter((p) => p.xero_tracking_option_id).map((p) => [p.xero_tracking_option_id!, p]));
  const unlinkedByKey = new Map<string, ProjectRow>();
  for (const p of own) {
    if (p.xero_tracking_option_id) continue;
    const k = p.match_key ?? matchKey(p.name);
    if (!unlinkedByKey.has(k)) unlinkedByKey.set(k, p);
  }
  const optionIds = new Set(options.map((o) => o.id));
  const touched = new Set<string>();
  let nextSort = Math.max(0, ...own.map((p) => p.sort_order ?? 0));
  const live = (o: OptionRow) => o.status === "active" && !o.missing_since;

  for (const opt of options) {
    let p = byOption.get(opt.id);
    if (!p) {
      p = unlinkedByKey.get(matchKey(opt.name));
      if (p) unlinkedByKey.delete(matchKey(opt.name));
    }
    if (!p) {
      if (live(opt)) {
        nextSort += 1;
        plan.inserts.push({
          org_id: orgId,
          name: opt.name,
          sort_order: nextSort,
          source: "xero_sync",
          xero_tracking_option_id: opt.id,
          is_active: true,
          archived_at: null,
        });
      }
      continue;
    }
    touched.add(p.id);
    const patch: Row = {};
    const kind: ProjectPlan["updates"][number]["kind"] = [];
    if (p.xero_tracking_option_id !== opt.id) {
      patch.xero_tracking_option_id = opt.id;
      kind.push("linked");
    }
    if (p.name !== opt.name) {
      patch.name = opt.name;
      kind.push("renamed");
    }
    if (live(opt) && !p.is_active) {
      patch.is_active = true;
      patch.archived_at = null;
      kind.push("reactivated");
    } else if (!live(opt) && p.is_active) {
      patch.is_active = false;
      patch.archived_at = p.archived_at ?? now;
      kind.push("archived");
    }
    if (kind.length > 0) plan.updates.push({ id: p.id, patch, kind });
  }

  if (options.some(live)) {
    for (const p of own) {
      if (touched.has(p.id) || !p.is_active) continue;
      // Linked to an option that is no longer in this category, or never
      // matched any Xero option at all: Xero doesn't have it.
      if (!p.xero_tracking_option_id || !optionIds.has(p.xero_tracking_option_id)) {
        plan.updates.push({ id: p.id, patch: { is_active: false, archived_at: p.archived_at ?? now }, kind: ["archived"] });
      }
    }
  }
  return plan;
}

/**
 * Which category plays a role ('schools', 'ministries') in this tenant.
 * Fills category_id only when it is empty, or when it still points at a
 * category with the role's name (e.g. the organisation was reconnected and
 * the old row went missing). A role pointing at a differently-named category
 * was remapped by an admin on purpose and is left alone.
 */
export function planRoleLink(
  role: { category_name: string; category_id: string | null },
  categories: Array<{ id: string; tenant_id: string; name: string; missing_since: string | null }>,
  tenantId: string
): string | null {
  const want = matchKey(role.category_name);
  const target = categories.find((c) => c.tenant_id === tenantId && !c.missing_since && matchKey(c.name) === want);
  if (!target || role.category_id === target.id) return null;
  if (role.category_id === null) return target.id;
  const current = categories.find((c) => c.id === role.category_id);
  if (current && matchKey(current.name) === want) return target.id;
  return null;
}

// ────────────────────────────────────────────────────────────
// Running it
// ────────────────────────────────────────────────────────────

type EntityCounts = { inserted: number; updated: number; unchanged: number; missing: number };

export type RegionSyncResult = {
  region: XeroRegion;
  status: "succeeded" | "partial" | "failed" | "skipped" | "busy" | "fresh";
  runId?: string;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  counts?: Record<string, any>;
};

function check<T extends { error: unknown }>(res: T, what: string): T {
  if (res.error) {
    const msg = (res.error as { message?: string }).message ?? String(res.error);
    throw new Error(`${what}: ${msg}`);
  }
  return res;
}

function chunks<T>(list: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function applyMirror(
  db: Client,
  entity: Entity,
  region: XeroRegion,
  tenantId: string,
  incoming: Row[],
  runId: string,
  now: string
): Promise<{ counts: EntityCounts; rows: Row[] }> {
  const cfg = ENTITIES[entity];
  const { data: existing } = check(
    await db.from(cfg.table).select("*").eq("org_region", region),
    `read ${cfg.table}`
  );
  const plan = planMirror(entity, existing ?? [], incoming, tenantId, now);
  const history: Row[] = [];
  const log = (id: string, changes: FieldChange[]) => {
    for (const c of changes) history.push({ run_id: runId, org_region: region, entity, entity_id: id, ...c, changed_at: now });
  };

  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map(({ xero_id, ...rest }) => ({
      ...rest,
      [cfg.xeroIdColumn]: xero_id,
      org_region: region,
      tenant_id: tenantId,
      first_seen_at: now,
      last_changed_at: now,
      synced_at: now,
    }));
    for (const part of chunks(rows)) check(await db.from(cfg.table).insert(part), `add to ${cfg.table}`);
  }
  for (const u of plan.updates) {
    check(await db.from(cfg.table).update({ ...u.patch, synced_at: now }).eq("id", u.id), `update ${cfg.table}`);
    log(u.id, u.changes);
  }
  for (const part of chunks(plan.unchanged)) {
    check(await db.from(cfg.table).update({ synced_at: now }).in("id", part), `touch ${cfg.table}`);
  }
  for (const part of chunks(plan.missing)) {
    check(
      await db.from(cfg.table).update({ missing_since: now, last_changed_at: now }).in("id", part.map((m) => m.id)),
      `mark missing in ${cfg.table}`
    );
    for (const m of part) log(m.id, m.changes);
  }
  for (const part of chunks(history, 500)) {
    check(await db.from("xero_mirror_changes").insert(part), "record changes");
  }

  const { data: after } = check(
    await db.from(cfg.table).select("*").eq("org_region", region),
    `re-read ${cfg.table}`
  );
  return {
    counts: {
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      unchanged: plan.unchanged.length,
      missing: plan.missing.length,
    },
    rows: after ?? [],
  };
}

async function linkRoles(db: Client, region: XeroRegion, tenantId: string, categories: Row[]) {
  const { data: roles } = check(
    await db.from("xero_tracking_roles").select("role_key, org_region, category_name, category_id").eq("org_region", region),
    "read tracking roles"
  );
  const linked: string[] = [];
  for (const role of (roles ?? []) as Row[]) {
    const target = planRoleLink(role as { category_name: string; category_id: string | null }, categories as never, tenantId);
    if (!target) continue;
    check(
      await db
        .from("xero_tracking_roles")
        .update({ category_id: target, updated_at: new Date().toISOString() })
        .eq("role_key", role.role_key)
        .eq("org_region", region),
      "link tracking role"
    );
    role.category_id = target;
    linked.push(role.role_key);
  }
  return { roles: (roles ?? []) as Row[], linked };
}

async function syncProjects(
  db: Client,
  region: XeroRegion,
  tenantId: string,
  roles: Row[],
  categories: Row[],
  options: Row[],
  now: string
): Promise<{ counts: Row; problem?: string }> {
  const { data: org } = check(
    await db.from("finance_orgs").select("id, key, projects_category_name").eq("key", REGION_TO_ORG_KEY[region]).maybeSingle(),
    "read finance org"
  );
  if (!org) return { counts: { skipped: "no finance org" }, problem: "The finance organisation is not set up (migration 290)." };

  const role = roles.find((r) => r.role_key === "ministries");
  let category = role?.category_id ? categories.find((c) => c.id === role.category_id) : undefined;
  if (!category || category.tenant_id !== tenantId) {
    const want = matchKey(org.projects_category_name ?? "Ministries");
    category = categories.find((c) => c.tenant_id === tenantId && !c.missing_since && matchKey(c.name) === want);
  }
  if (!category) {
    return {
      counts: { skipped: "no Ministries category" },
      problem: `Xero has no "${org.projects_category_name ?? "Ministries"}" tracking category, so projects were left as they are.`,
    };
  }

  const catOptions = options.filter((o) => o.category_id === category!.id && o.tenant_id === tenantId) as OptionRow[];
  // A category with no live options at all is far more likely a Xero hiccup
  // than every ministry closing at once: leave projects as they are.
  if (!catOptions.some((o) => o.status === "active" && !o.missing_since)) {
    return {
      counts: { skipped: "no live Ministries options" },
      problem: "Xero returned no active Ministries options, so projects were left as they are.",
    };
  }
  const { data: projects } = check(
    await db
      .from("finance_projects")
      .select("id, org_id, name, match_key, sort_order, is_active, archived_at, xero_tracking_option_id")
      .eq("org_id", org.id),
    "read projects"
  );
  const plan = planProjects(org.id, (projects ?? []) as ProjectRow[], catOptions, now);
  const counts: Row = { inserted: 0, linked: 0, renamed: 0, archived: 0, reactivated: 0, conflicts: 0 };
  const conflicts: string[] = [];

  // A rename onto a name another project still holds (unique per org) is
  // the one write that can clash; it is counted and retried next run rather
  // than stopping the rest.
  for (const u of plan.updates) {
    const res = await db.from("finance_projects").update(u.patch).eq("id", u.id);
    if (res.error) {
      counts.conflicts += 1;
      conflicts.push(res.error.message);
      continue;
    }
    for (const k of u.kind) counts[k] += 1;
  }
  for (const ins of plan.inserts) {
    const res = await db.from("finance_projects").insert(ins);
    if (res.error) {
      counts.conflicts += 1;
      conflicts.push(res.error.message);
      continue;
    }
    counts.inserted += 1;
  }
  return {
    counts,
    problem: conflicts.length > 0 ? `${conflicts.length} project(s) could not be updated: ${conflicts[0]}` : undefined,
  };
}

/** Sync one region. Never throws; the outcome is in the result and the run row. */
export async function syncXeroRegion(
  db: Client,
  region: XeroRegion,
  opts: { trigger: XeroSyncTrigger; startedBy?: string | null; fetchSource?: typeof fetchXeroMirrorSource }
): Promise<RegionSyncResult> {
  const startedAt = new Date();
  const now = startedAt.toISOString();

  // Close runs that died mid-way, so they don't hold the lock forever.
  await db
    .from("xero_sync_runs")
    .update({ status: "failed", finished_at: now, error: "Stopped before it finished." })
    .eq("org_region", region)
    .eq("status", "running")
    .lt("started_at", new Date(startedAt.getTime() - STALE_RUN_MS).toISOString());

  const started = await db
    .from("xero_sync_runs")
    .insert({ org_region: region, kind: "all", trigger: opts.trigger, started_by: opts.startedBy ?? null, status: "running", started_at: now })
    .select("id")
    .single();
  if (started.error) {
    // 23505: another sync for this region is running right now (migration 291).
    if (started.error.code === "23505") return { region, status: "busy" };
    return { region, status: "failed", error: started.error.message };
  }
  const runId: string = started.data.id;

  const finish = async (status: RegionSyncResult["status"], extra: { tenant_id?: string; counts?: Row; error?: string }) => {
    await db
      .from("xero_sync_runs")
      .update({ status, finished_at: new Date().toISOString(), ...extra })
      .eq("id", runId);
    return { region, runId, status, error: extra.error, counts: extra.counts } as RegionSyncResult;
  };

  let source: XeroMirrorSource;
  try {
    source = await (opts.fetchSource ?? fetchXeroMirrorSource)(db, region);
  } catch (err) {
    source = { ok: false, reason: "xero", message: err instanceof Error ? err.message : String(err) };
  }
  if (!source.ok) {
    return finish(source.reason === "not_connected" ? "skipped" : "failed", {
      tenant_id: source.tenantId,
      error: source.message,
    });
  }

  const tenantId = source.tenantId;
  try {
    const counts: Row = {};
    const categories = await applyMirror(
      db, "tracking_category", region, tenantId, source.trackingCategories.map(categoryFromXero), runId, now
    );
    counts.tracking_categories = categories.counts;

    const categoryIdByXeroId = new Map(
      categories.rows.filter((c) => c.tenant_id === tenantId).map((c) => [c.xero_category_id, c.id])
    );
    const incomingOptions = source.trackingCategories.flatMap((c) => {
      const categoryId = categoryIdByXeroId.get(c.TrackingCategoryID);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return categoryId ? (c.Options ?? []).map((o: any) => optionFromXero(o, categoryId)) : [];
    });
    const options = await applyMirror(db, "tracking_option", region, tenantId, incomingOptions, runId, now);
    counts.tracking_options = options.counts;

    counts.accounts = (await applyMirror(db, "account", region, tenantId, source.accounts.map(accountFromXero), runId, now)).counts;
    counts.items = (await applyMirror(db, "item", region, tenantId, source.items.map(itemFromXero), runId, now)).counts;

    const { roles, linked } = await linkRoles(db, region, tenantId, categories.rows);
    counts.roles_linked = linked;

    const projects = await syncProjects(db, region, tenantId, roles, categories.rows, options.rows, now);
    counts.projects = projects.counts;

    return finish(projects.problem ? "partial" : "succeeded", {
      tenant_id: tenantId,
      counts,
      error: projects.problem,
    });
  } catch (err) {
    return finish("failed", { tenant_id: tenantId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Sync each region in turn. One region failing never stops the next. */
export async function syncXeroMirror(
  db: Client,
  opts: {
    regions?: XeroRegion[];
    trigger: XeroSyncTrigger;
    startedBy?: string | null;
    /** Only sync a region whose last attempt is older than this. */
    maxAgeMs?: number;
    fetchSource?: typeof fetchXeroMirrorSource;
  }
): Promise<RegionSyncResult[]> {
  const results: RegionSyncResult[] = [];
  for (const region of opts.regions ?? XERO_REGIONS) {
    try {
      if (opts.maxAgeMs !== undefined && (await lastAttemptWithin(db, region, opts.maxAgeMs))) {
        results.push({ region, status: "fresh" });
        continue;
      }
      results.push(await syncXeroRegion(db, region, opts));
    } catch (err) {
      results.push({ region, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function lastAttemptWithin(db: Client, region: XeroRegion, maxAgeMs: number): Promise<boolean> {
  const { data } = await db
    .from("xero_sync_runs")
    .select("started_at")
    .eq("org_region", region)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.started_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < maxAgeMs;
}

// ────────────────────────────────────────────────────────────
// Freshness, for "Updated from Xero {time}"
// ────────────────────────────────────────────────────────────

/** Reads with the caller's own client: finance readers only (RLS, 275). */
export async function getXeroMirrorFreshness(supabase: Client): Promise<XeroMirrorFreshness[]> {
  return Promise.all(
    XERO_REGIONS.map(async (region) => {
      const [{ data: last }, { data: ok }] = await Promise.all([
        supabase
          .from("xero_sync_runs")
          .select("status, started_at, finished_at, error")
          .eq("org_region", region)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("xero_sync_runs")
          .select("finished_at")
          .eq("org_region", region)
          .in("status", ["succeeded", "partial"])
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return { region, lastUpdatedAt: ok?.finished_at ?? null, lastRun: last ?? null };
    })
  );
}
