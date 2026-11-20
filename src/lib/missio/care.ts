import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneE164 } from "@/lib/phone";
import { getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import type { OrgAccess } from "@/lib/missio/access";
import { MISSIO_SLUG } from "@/lib/missio/access";
import { connectRateKeyHash } from "@/lib/missio/match-token";
import type { MissioErrorCode } from "@/lib/missio/types";

/**
 * Care (board M14b). Migration 343.
 *
 * One board fed from every door: the public care form, prayer on connect
 * cards, prayer from weekly house feedback, and needs a pastor logs by hand.
 * Connect cards and feedback are pulled in when the board loads (once each,
 * by source + id). New → someone's on it → done. Pastors only for now.
 */

export type CareNeed = "prayer" | "talk" | "practical";
export type CarePrivacy = "pastors" | "pastors_leaders" | "house";
export type CareStatus = "new" | "on_it" | "done";
export type CareSource = "care_form" | "connect_card" | "house_feedback" | "manual";

export type CareRequest = {
  id: string;
  source: CareSource;
  /** Null for an anonymous prayer request. */
  name: string | null;
  phone: string | null;
  needs: CareNeed[];
  body: string | null;
  privacy: CarePrivacy;
  urgent: boolean;
  status: CareStatus;
  house: { id: string; number: number; name: string | null } | null;
  takenBy: { id: string; name: string } | null;
  createdAt: string;
  takenAt: string | null;
  doneAt: string | null;
  doneNote: string | null;
  /** Done two weeks ago and nobody has checked back in yet. */
  checkIn: boolean;
};

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode; headers?: Record<string, string> };
const fail = (status: number, code: MissioErrorCode, error: string): Fail => ({ ok: false, status, code, error });
const broken = () => fail(500, "server_error", "Something went wrong.");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type Row = {
  id: string;
  source: CareSource;
  name: string | null;
  phone: string | null;
  needs: CareNeed[];
  body: string | null;
  privacy: CarePrivacy;
  urgent: boolean;
  status: CareStatus;
  house_church_id: string | null;
  taken_by: string | null;
  created_at: string;
  taken_at: string | null;
  done_at: string | null;
  done_note: string | null;
  checked_in_at: string | null;
};
const COLUMNS =
  "id, source, name, phone, needs, body, privacy, urgent, status, house_church_id, taken_by, created_at, taken_at, done_at, done_note, checked_in_at";

const CHECK_IN_DAYS = 14;
const PULL_DAYS = 60;
const NEEDS = ["prayer", "talk", "practical"] as const;

function admin(): Db | null {
  try {
    return createAdminClient();
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return null;
  }
}

/** Bring connect-card and house-feedback prayer onto the board, once each. Best effort. */
async function pullSources(auth: OrgAccess, now: Date) {
  const since = new Date(now.getTime() - PULL_DAYS * 86400000).toISOString();
  const [cards, feedback, existing] = await Promise.all([
    auth.supabase
      .from("connect_responses")
      .select("id, name, phone, prayer_request, matched_contact_id, submitted_at")
      .eq("org_id", auth.orgId)
      .eq("wants_prayer", true)
      .gte("submitted_at", since),
    auth.supabase
      .from("missio_house_feedback")
      .select("id, house_church_id, prayer, submitted_at")
      .gte("submitted_at", since)
      .not("prayer", "is", null),
    auth.supabase
      .from("missio_care_requests")
      .select("source, source_id")
      .eq("org_id", auth.orgId)
      .in("source", ["connect_card", "house_feedback"])
      .gte("created_at", new Date(now.getTime() - (PULL_DAYS + 7) * 86400000).toISOString()),
  ]);
  if (existing.error) return;
  const seen = new Set(((existing.data ?? []) as Array<{ source: string; source_id: string }>).map((row) => `${row.source}:${row.source_id}`));
  const rows: Record<string, unknown>[] = [];
  if (!cards.error) {
    for (const card of (cards.data ?? []) as Array<{ id: string; name: string; phone: string; prayer_request: string | null; matched_contact_id: string | null; submitted_at: string }>) {
      if (seen.has(`connect_card:${card.id}`)) continue;
      rows.push({
        org_id: auth.orgId,
        source: "connect_card",
        source_id: card.id,
        contact_id: card.matched_contact_id,
        name: card.name?.trim().slice(0, 80) || null,
        phone: card.phone?.trim().slice(0, 40) || null,
        needs: ["prayer"],
        body: card.prayer_request?.trim().slice(0, 2000) || null,
        privacy: "pastors",
        created_at: card.submitted_at,
      });
    }
  }
  if (!feedback.error) {
    for (const week of (feedback.data ?? []) as Array<{ id: string; house_church_id: string; prayer: string | null; submitted_at: string }>) {
      if (!week.prayer?.trim() || seen.has(`house_feedback:${week.id}`)) continue;
      rows.push({
        org_id: auth.orgId,
        source: "house_feedback",
        source_id: week.id,
        house_church_id: week.house_church_id,
        needs: ["prayer"],
        body: week.prayer.trim().slice(0, 2000),
        privacy: "pastors_leaders",
        created_at: week.submitted_at,
      });
    }
  }
  for (const row of rows) {
    const inserted = await auth.supabase.from("missio_care_requests").insert(row);
    if (inserted.error && inserted.error.code !== "23505") {
      console.error("[missio] care pull failed", inserted.error.message);
      return;
    }
  }
}

async function shape(auth: OrgAccess, rows: Row[], now: Date): Promise<CareRequest[]> {
  const houseIds = [...new Set(rows.map((row) => row.house_church_id).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(rows.map((row) => row.taken_by).filter((id): id is string => Boolean(id)))];
  const houses = new Map<string, { id: string; number: number; name: string | null }>();
  const users = new Map<string, string>();
  if (houseIds.length > 0) {
    const read = await auth.supabase.from("house_churches").select("id, number, name").in("id", houseIds);
    for (const house of (read.data ?? []) as Array<{ id: string; number: number; name: string | null }>) houses.set(house.id, house);
  }
  if (userIds.length > 0) {
    const db = admin();
    const read = db ? await db.from("users").select("id, first_name, last_name, preferred_name").in("id", userIds) : { data: [] };
    for (const user of (read.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }>) {
      users.set(user.id, [user.preferred_name || user.first_name, user.last_name].filter(Boolean).join(" ") || "A pastor");
    }
  }
  const checkBefore = now.getTime() - CHECK_IN_DAYS * 86400000;
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    name: row.name,
    phone: row.phone,
    needs: (row.needs ?? ["prayer"]).filter((need): need is CareNeed => (NEEDS as readonly string[]).includes(need)),
    body: row.body,
    privacy: row.privacy,
    urgent: row.urgent,
    status: row.status,
    house: row.house_church_id ? (houses.get(row.house_church_id) ?? null) : null,
    takenBy: row.taken_by ? { id: row.taken_by, name: users.get(row.taken_by) ?? "A pastor" } : null,
    createdAt: row.created_at,
    takenAt: row.taken_at,
    doneAt: row.done_at,
    doneNote: row.done_note,
    checkIn: row.status === "done" && !row.checked_in_at && Boolean(row.done_at) && Date.parse(row.done_at!) <= checkBefore,
  }));
}

/** The board: everything new or on it, plus what was done in the last 45 days. Urgent first. */
export async function listCare(auth: OrgAccess, now = new Date()): Promise<{ ok: true; requests: CareRequest[]; me: string } | Fail> {
  await pullSources(auth, now);
  const recent = new Date(now.getTime() - 45 * 86400000).toISOString();
  const [open, done] = await Promise.all([
    auth.supabase.from("missio_care_requests").select(COLUMNS).eq("org_id", auth.orgId).in("status", ["new", "on_it"]).limit(500),
    auth.supabase.from("missio_care_requests").select(COLUMNS).eq("org_id", auth.orgId).eq("status", "done").gte("done_at", recent).limit(200),
  ]);
  if (open.error || done.error) {
    console.error("[missio] care read failed", (open.error ?? done.error)?.message);
    return broken();
  }
  const rows = [...((open.data ?? []) as Row[]), ...((done.data ?? []) as Row[])].sort(
    (a, b) => Number(b.urgent && b.status !== "done") - Number(a.urgent && a.status !== "done") || b.created_at.localeCompare(a.created_at)
  );
  const requests = await shape(auth, rows, now);
  const db = admin();
  const me = db ? await db.from("users").select("first_name, preferred_name").eq("id", auth.user.id).maybeSingle() : { data: null };
  const meName = ((me.data as { first_name?: string | null; preferred_name?: string | null } | null)?.preferred_name ||
    (me.data as { first_name?: string | null } | null)?.first_name ||
    "") as string;
  return { ok: true, requests, me: meName };
}

const stepSchema = z
  .object({
    action: z.enum(["take", "done", "reopen", "checked_in"]),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

/** I'll take it / Done / Back to new / Checked back in. */
export async function stepCare(auth: OrgAccess, id: string, body: unknown, now = new Date()) {
  const parsed = stepSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const read = await auth.supabase.from("missio_care_requests").select("id, status").eq("id", id).eq("org_id", auth.orgId).maybeSingle();
  if (read.error) return broken();
  if (!read.data) return fail(404, "not_found", "Not found.");
  const at = now.toISOString();
  const status = (read.data as { status: CareStatus }).status;
  const { action, note } = parsed.data;
  let patch: Record<string, unknown>;
  if (action === "take") {
    if (status !== "new") return fail(409, "already_resolved", "Someone already took this.");
    patch = { status: "on_it", taken_by: auth.user.id, taken_at: at };
  } else if (action === "done") {
    patch = { status: "done", done_at: at, done_note: note || null, ...(status === "new" ? { taken_by: auth.user.id, taken_at: at } : {}) };
  } else if (action === "reopen") {
    patch = { status: "new", taken_by: null, taken_at: null, done_at: null, done_note: null };
  } else {
    patch = { checked_in_at: at };
  }
  let query = auth.supabase.from("missio_care_requests").update(patch).eq("id", id);
  if (action === "take") query = query.eq("status", "new");
  const saved = await query.select("id");
  if (saved.error) return broken();
  if (((saved.data ?? []) as unknown[]).length === 0) return fail(409, "already_resolved", "Someone already took this.");
  return { ok: true as const };
}

const logSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().max(40).optional(),
    needs: z.array(z.enum(NEEDS)).min(1).max(3),
    body: z.string().trim().min(1).max(2000),
    privacy: z.enum(["pastors", "pastors_leaders", "house"]).default("pastors"),
    urgent: z.boolean().default(false),
  })
  .strict();

/** A pastor logs a need by hand (ministry time, a phone call). */
export async function logCare(auth: OrgAccess, body: unknown) {
  const parsed = logSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const input = parsed.data;
  const inserted = await auth.supabase.from("missio_care_requests").insert({
    org_id: auth.orgId,
    source: "manual",
    name: input.name ?? null,
    phone: input.phone && input.phone.length >= 5 ? input.phone : null,
    needs: [...new Set(input.needs)],
    body: input.body,
    privacy: input.privacy,
    urgent: input.urgent,
    created_by: auth.user.id,
  });
  if (inserted.error) return broken();
  return { ok: true as const };
}

// ── The public care form ───────────────────────────────────────

const formSchema = z
  .object({
    needs: z.array(z.enum(NEEDS)).min(1).max(3),
    body: z.string().trim().max(2000).optional(),
    privacy: z.enum(["pastors", "pastors_leaders", "house"]),
    name: z.string().trim().max(80).optional(),
    phone: z.string().trim().max(40).optional(),
    urgent: z.boolean().default(false),
    consent: z.literal(true),
    website: z.string().optional(),
  })
  .strict();

export const CARE_IP_LIMIT = 5;
export const CARE_WINDOW_SECONDS = 10 * 60;

/**
 * POST from /serve/missio/care. No session. Talk, practical help and urgent
 * need a phone (someone will reply); prayer alone can be anonymous.
 */
export async function submitCareForm(body: unknown, ip: string): Promise<{ ok: true; first: string | null } | Fail> {
  const limiter = getRateLimiter();
  const perIp = await limiter.hit(`missio:care:ip:${ip}`, { limit: CARE_IP_LIMIT, windowSeconds: CARE_WINDOW_SECONDS });
  if (!perIp.allowed) return { ...fail(429, "rate_limited", "Too many attempts. Try again shortly."), headers: { "Retry-After": String(retryAfterSeconds(perIp)) } };
  const parsed = formSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the details and try again.");
  const input = parsed.data;
  if (input.website?.trim()) return { ok: true, first: null };
  const needs = [...new Set(input.needs)];
  const phone = input.phone?.trim() || null;
  const replies = input.urgent || needs.some((need) => need !== "prayer");
  if (phone && !normalizePhoneE164(phone)) return fail(400, "invalid_input", "Check the phone number.");
  if (replies && !phone) return fail(400, "invalid_input", "Add a phone number so someone can reply.");
  if (!input.body?.trim() && needs.length === 1 && needs[0] === "prayer" && !input.name?.trim()) {
    return fail(400, "invalid_input", "Tell us a little, so we know how to pray.");
  }
  const db = admin();
  if (!db) return broken();
  const org = await db.from("organisations").select("id").eq("slug", MISSIO_SLUG).maybeSingle();
  if (org.error || !org.data) return broken();
  const inserted = await db.from("missio_care_requests").insert({
    org_id: (org.data as { id: string }).id,
    source: "care_form",
    name: input.name?.trim() || null,
    phone,
    needs,
    body: input.body?.trim() || null,
    privacy: input.privacy,
    urgent: input.urgent,
    rate_key_hash: connectRateKeyHash(ip),
  });
  if (inserted.error) {
    console.error("[missio] care form insert failed", inserted.error.message);
    return broken();
  }
  return { ok: true, first: input.name?.trim().split(/\s+/)[0] ?? null };
}
