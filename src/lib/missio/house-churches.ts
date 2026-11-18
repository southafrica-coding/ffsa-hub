import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole, type OrgAccess } from "@/lib/missio/access";
import {
  fieldError,
  invalidInput,
  isHouseChurchErrorCode,
  mapMembershipEndError,
  mapMissioDbError,
  MEMBER_LEFT_MISSIO_MESSAGE,
  type HouseChurchErrorCode,
} from "@/lib/missio/db-errors";
import { endDateFor, isAfterDatabaseToday, todayIsoDate } from "@/lib/missio/dates";
import { membershipBlocksInsert, membershipIsCurrent, membershipIsOpen } from "@/lib/missio/house-church-import";
import { maskEmail, maskPhone } from "@/lib/missio/mask";
import { createPerson } from "@/lib/missio/people";
import type {
  HouseChurchDetail,
  HouseChurchDetailResponse,
  HouseChurchListResponse,
  HouseChurchMemberView,
  HouseChurchRole,
  HouseChurchSummary,
  ImportReviewItem,
  ImportReviewListResponse,
  ImportReviewStatus,
  MissioCampus,
  PersonRef,
  ResolveImportReviewResponse,
  ReviewContactMatch,
  ReviewContactSearchResponse,
} from "@/lib/missio/types";

// Pastors only, matching migration 331: has_org_role('missio', ARRAY['pastor']).
// is_admin(), has_role(), and has_any_role() are not a pass. resolveHouseScope
// is the single place a later house_church_leader grant would narrow this to
// that person's houses. v1 returns 'all' for pastors and null for everyone
// else. That scope is not shipped: pastorHouseAccess still requires pastor.
//
// Names come from a service-role read of contacts after the pastor check.
// Pastors cannot read contacts. These routes do not create org_people.
// POST members and import-review link accept only a contact who already has
// an org_people row in Missio. Status is not filtered: migration 331 allows
// a visitor. Anyone with no row is not_missio_person, and nothing is inserted.
// import-review create still uses the Phase 0 create-person path.
// Candidate suggestions are limited to people who have that row. DELETE only
// sets ended_at to the UTC database date and never changes org_people.
// A start after that date is invalid_input on POST. PATCH changes role only.
// An already-ended membership is membership_not_current.
// A current membership is an open row (ended_at IS NULL) whose started_at is
// on or before that date. ended_at after today is rejected by the database.
//
// Pastors may UPDATE missio_import_review only on status, resolved_contact_id,
// notes, resolved_by, and resolved_at. Insert and delete stay on the service role.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const ROLES = ["leader", "co_leader", "member"] as const;
const REVIEW_STATUSES = ["pending", "matched", "new", "skipped"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HOUSE_COLUMNS = "id, org_id, number, name, campus, meeting_day, location, leader_notes";
const MEMBER_COLUMNS = "id, house_church_id, contact_id, role, started_at, ended_at";
const REVIEW_COLUMNS =
  "id, org_id, source_line, raw_name, house_number, role, kind, match_type, candidate_contact_ids, status, resolved_contact_id, notes, resolved_by, resolved_at, created_at";

/** The only missio_import_review columns authenticated pastors may UPDATE. */
const REVIEW_RESOLVE_COLUMNS = ["status", "resolved_contact_id", "notes", "resolved_by", "resolved_at"] as const;

const ROLE_ORDER: Record<HouseChurchRole, number> = { leader: 0, co_leader: 1, member: 2 };

export type HouseScope = { mode: "all" } | { mode: "houses"; ids: readonly string[] };

type Fail = {
  ok: false;
  status: number;
  error: string;
  code: HouseChurchErrorCode;
  fieldErrors?: Record<string, string>;
};

type HouseRow = {
  id: string;
  org_id: string;
  number: number;
  name: string | null;
  campus: string | null;
  meeting_day: string | null;
  location: string | null;
  leader_notes: string | null;
};

type MemberRow = {
  id: string;
  house_church_id: string;
  contact_id: string;
  role: string;
  started_at: string | null;
  ended_at: string | null;
};

type ReviewRow = {
  id: string;
  org_id: string;
  source_line: number;
  raw_name: string;
  house_number: number;
  role: string;
  kind: string | null;
  match_type: string | null;
  candidate_contact_ids: string[] | null;
  status: string;
  resolved_contact_id: string | null;
  notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

type ContactNameRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
};

function fail(status: number, code: HouseChurchErrorCode, error: string, fieldErrors?: Record<string, string>): Fail {
  return fieldErrors ? { ok: false, status, code, error, fieldErrors } : { ok: false, status, code, error };
}

/** Response body for a failed call. fieldErrors is paths plus our messages. */
export function publicError(result: Fail): {
  error: string;
  code: HouseChurchErrorCode;
  fieldErrors?: Record<string, string>;
} {
  const body: { error: string; code: HouseChurchErrorCode; fieldErrors?: Record<string, string> } = {
    error: result.error,
    code: result.code,
  };
  if (result.code === "invalid_input") body.fieldErrors = result.fieldErrors ?? {};
  return body;
}

function zodFail(error: z.ZodError): Fail {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    if (path) {
      if (!fieldErrors[path]) Object.assign(fieldErrors, fieldError(path));
      continue;
    }
    const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys : [];
    for (const key of keys) {
      if (typeof key === "string" && key && !fieldErrors[key]) Object.assign(fieldErrors, fieldError(key));
    }
  }
  const mapped = invalidInput(fieldErrors);
  return fail(mapped.status, mapped.code, mapped.error, mapped.fieldErrors);
}

/** People-module codes that are not in the house-church contract become one of the pinned codes. */
function fromPersonError(status: number, code: string | undefined): Fail {
  if (code === "exists_use_search") return fail(400, "not_missio_person", "This person is not in Missio.");
  if (code === "already_in_org") return fail(409, "already_in_org", "This person is already in Missio.");
  if (code && isHouseChurchErrorCode(code)) {
    if (code === "invalid_input") return fail(400, "invalid_input", "Check the fields and try again.", {});
    if (code === "server_error") return fail(500, "server_error", "Something went wrong.");
    if (code === "not_found") return fail(404, "not_found", "Review item not found.");
    return fail(status, code, "Something went wrong.");
  }
  return fail(500, "server_error", "Something went wrong.");
}

function isFail(value: Map<string, PersonRef> | Fail): value is Fail {
  return "ok" in value && value.ok === false;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export { todayIsoDate } from "@/lib/missio/dates";

export function toPersonRef(contact: ContactNameRow, orgPersonId?: string | null): PersonRef {
  const firstName = blankToNull(contact.first_name);
  const lastName = blankToNull(contact.last_name);
  const preferred = blankToNull(contact.preferred_name);
  const given = preferred ?? firstName ?? "";
  const displayName = [given, lastName ?? ""].filter(Boolean).join(" ");
  const ref: PersonRef = { contactId: contact.id, displayName, firstName, lastName };
  if (orgPersonId) ref.orgPersonId = orgPersonId;
  return ref;
}

/**
 * Pastors see every house. A later house_church_leader grant should return
 * { mode: "houses", ids } from here and nowhere else. It does not do that yet.
 */
export function resolveHouseScope(auth: { roles: readonly string[] }): HouseScope | null {
  if (auth.roles.includes("pastor")) return { mode: "all" };
  return null;
}

export function houseInScope(scope: HouseScope, houseId: string): boolean {
  if (scope.mode === "all") return true;
  return scope.ids.includes(houseId);
}

/** @returns the same query for pastors. Null means the scope names no houses. */
export function restrictHouseQuery(query: Client, scope: HouseScope, column = "id"): Client | null {
  if (scope.mode === "all") return query;
  if (scope.ids.length === 0) return null;
  return query.in(column, [...scope.ids]);
}

export async function pastorHouseAccess(): Promise<
  { auth: OrgAccess; scope: HouseScope } | { response: NextResponse }
> {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return { response: auth.response };
  const scope = resolveHouseScope(auth);
  if (!scope) {
    return {
      response: NextResponse.json({ error: "Not authorized", code: "forbidden" }, { status: 403 }),
    };
  }
  return { auth, scope };
}

export function parseReviewStatus(value: string | null): ImportReviewStatus | "all" | null {
  if (value === null || value === "" || value === "pending") return "pending";
  if (value === "all" || value === "matched" || value === "new" || value === "skipped") return value;
  if ((REVIEW_STATUSES as readonly string[]).includes(value)) return value as ImportReviewStatus;
  return null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const addMemberSchema = z
  .object({
    contactId: z.string().uuid(),
    role: z.enum(ROLES),
    startedAt: isoDate.nullable().optional(),
  })
  .strict();

const roleSchema = z.object({ role: z.enum(ROLES) }).strict();

const resolveSchema = z.discriminatedUnion("action", [
  // `also` adds one more person to a row that is already resolved, for a
  // sheet name that stands for a couple or a household.
  z.object({ action: z.literal("link"), contactId: z.string().uuid(), also: z.literal(true).optional() }).strict(),
  z
    .object({
      action: z.literal("create"),
      firstName: z.string().trim().min(1).max(200),
      lastName: z.string().trim().max(200).nullable().optional(),
      email: z.string().trim().email().max(320).nullable().optional(),
      phone: z.string().trim().min(1).max(40).nullable().optional(),
      also: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("skip"),
      notes: z.string().trim().max(2000).nullable().optional(),
    })
    .strict(),
]);

function adminClient(): { client: Client } | { error: string } {
  try {
    return { client: createAdminClient() };
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return { error: "Something went wrong." };
  }
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function asCampus(value: string | null | undefined): MissioCampus {
  return value === "jhb" ? "jhb" : "potch";
}

function asRole(value: string | null | undefined): HouseChurchRole | null {
  if (value === "leader" || value === "co_leader" || value === "member") return value;
  return null;
}

function asReviewStatus(value: string | null | undefined): ImportReviewStatus | null {
  if (value === "pending" || value === "matched" || value === "new" || value === "skipped") return value;
  return null;
}

function emptyToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function audit(
  admin: Client,
  row: { userId: string; action: string; resourceType: string; resourceId: string; changes: Record<string, unknown> }
) {
  const { error } = await admin.from("audit_logs").insert({
    user_id: row.userId,
    action: row.action,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    changes: row.changes,
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[missio] audit failed", error.message ?? "insert failed");
}

const NOT_MISSIO = fail(400, "not_missio_person", "This person is not in Missio.");

/**
 * One Missio lookup. org_people_directory is org_people plus the name, so a
 * missing row and a contact who is not in Missio look the same. This does
 * not read the contacts table and does not insert org_people.
 */
async function requireMissioPerson(
  auth: OrgAccess,
  contactId: string
): Promise<{ ok: true; orgPersonId: string; contact: ContactNameRow } | Fail> {
  const existing = await auth.supabase
    .from("org_people_directory")
    .select("id, contact_id, first_name, last_name, preferred_name")
    .eq("org_id", auth.orgId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existing.error) {
    console.error("[missio] org person lookup failed", existing.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const row = existing.data as {
    id?: string;
    contact_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    preferred_name?: string | null;
  } | null;
  if (!row?.id || !row.contact_id) return NOT_MISSIO;
  return {
    ok: true,
    orgPersonId: row.id,
    contact: {
      id: row.contact_id,
      first_name: row.first_name,
      last_name: row.last_name,
      preferred_name: row.preferred_name,
    },
  };
}

/** Postgres errors go through mapMissioDbError. The database text stays out of the body. */
function dbWriteError(error: { code?: string; message?: string; details?: string; hint?: string }, label: string): Fail {
  if (label === "membership write" && error.code === "23505") {
    console.error("[missio] membership write failed", error.code);
    return fail(409, "already_member", "This person is already in this house.");
  }
  const mapped = mapMissioDbError(error);
  console.error(`[missio] ${label} failed`, error.code ?? "write failed");
  return fail(mapped.status, mapped.code, mapped.error, mapped.fieldErrors);
}

async function loadRefs(auth: OrgAccess, contactIds: string[]): Promise<Map<string, PersonRef> | Fail> {
  const ids = [...new Set(contactIds)];
  const map = new Map<string, PersonRef>();
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    if (slice.length === 0) continue;
    const directory = await auth.supabase
      .from("org_people_directory")
      .select("id, contact_id, first_name, last_name, preferred_name")
      .eq("org_id", auth.orgId)
      .in("contact_id", slice);
    if (directory.error) {
      console.error("[missio] org person lookup failed", directory.error.message);
      return fail(500, "server_error", "Something went wrong.");
    }
    for (const row of (directory.data ?? []) as Array<{
      id?: string;
      contact_id?: string;
      first_name?: string | null;
      last_name?: string | null;
      preferred_name?: string | null;
    }>) {
      if (!row.contact_id || !row.id) continue;
      map.set(
        row.contact_id,
        toPersonRef(
          {
            id: row.contact_id,
            first_name: row.first_name,
            last_name: row.last_name,
            preferred_name: row.preferred_name,
          },
          row.id
        )
      );
    }
  }
  return map;
}

function contactHint(email: string | null | undefined, phone: string | null | undefined): string | undefined {
  const parts = [maskEmail(email), maskPhone(phone)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

type ContactHintRow = ContactNameRow & { email?: string | null; phone?: string | null };

/**
 * Names for import-review candidates. The sheet is the source of Missio
 * people (Jack, 18 Nov 2026), so a candidate may be a contact with no Missio
 * row yet. Missio people come from the directory as before. Everyone else is
 * read with the service role, after the pastor check, as a name plus a masked
 * email and phone. Nothing else about the contact leaves the server.
 */
async function loadReviewRefs(auth: OrgAccess, contactIds: string[]): Promise<Map<string, PersonRef> | Fail> {
  const refs = await loadRefs(auth, contactIds);
  if (isFail(refs)) return refs;
  const missing = [...new Set(contactIds)].filter((id) => !refs.has(id));
  if (missing.length === 0) return refs;
  const admin = adminClient();
  if ("error" in admin) return fail(500, "server_error", "Something went wrong.");
  for (let i = 0; i < missing.length; i += 100) {
    const slice = missing.slice(i, i + 100);
    const contacts = await admin.client
      .from("contacts")
      .select("id, first_name, last_name, preferred_name, email, phone")
      .in("id", slice);
    if (contacts.error) {
      console.error("[missio] review candidate lookup failed", contacts.error.message);
      return fail(500, "server_error", "Something went wrong.");
    }
    for (const row of (contacts.data ?? []) as ContactHintRow[]) {
      if (!row.id) continue;
      const ref = toPersonRef(row);
      const hint = contactHint(row.email, row.phone);
      if (hint) ref.hint = hint;
      refs.set(row.id, ref);
    }
  }
  return refs;
}

const SEARCH_LIMIT = 8;

/**
 * Name search across every contact, for the import review queue only.
 * Pastor check first, then a service-role read. Returns at most eight
 * matches: name, masked email and phone, and whether they are already in
 * Missio. One audit row per search.
 */
export async function searchReviewContacts(
  auth: OrgAccess,
  q: string
): Promise<{ ok: true; body: ReviewContactSearchResponse } | Fail> {
  const tokens = q
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[,()%_\\*]/g, ""))
    .filter((token) => token.length >= 2)
    .slice(0, 4);
  if (tokens.length === 0) {
    return fail(400, "invalid_input", "Enter at least two letters of a name.", { q: "Enter at least two letters of a name." });
  }
  const admin = adminClient();
  if ("error" in admin) return fail(500, "server_error", "Something went wrong.");

  let request = admin.client.from("contacts").select("id, first_name, last_name, preferred_name, email, phone");
  for (const token of tokens) {
    const term = `%${token}%`;
    request = request.or(`first_name.ilike.${term},last_name.ilike.${term},preferred_name.ilike.${term}`);
  }
  const found = await request.order("last_name", { ascending: true }).order("first_name", { ascending: true }).limit(SEARCH_LIMIT);
  if (found.error) {
    console.error("[missio] review contact search failed", found.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const rows = ((found.data ?? []) as ContactHintRow[]).filter((row) => Boolean(row.id));
  const inMissio = rows.length > 0 ? await loadRefs(auth, rows.map((row) => row.id)) : new Map<string, PersonRef>();
  if (isFail(inMissio)) return inMissio;

  const matches: ReviewContactMatch[] = rows.map((row) => {
    const member = inMissio.get(row.id);
    const ref = toPersonRef(row, member?.orgPersonId);
    const hint = contactHint(row.email, row.phone);
    if (hint) ref.hint = hint;
    return { ...ref, inMissio: Boolean(member?.orgPersonId) };
  });

  await audit(admin.client, {
    userId: auth.user.id,
    action: "missio.import_review_contact_search",
    resourceType: "missio_import_review",
    resourceId: auth.orgId,
    changes: { tokens: tokens.length, results: matches.length },
  });
  return { ok: true, body: { matches } };
}

/**
 * Give a contact a Missio people row so an import-review row can link to
 * them. The contact must exist. Migration 329's trigger mirrors the Missio
 * label. An existing row is left as it is.
 */
async function ensureMissioPerson(auth: OrgAccess, contactId: string, campus: MissioCampus): Promise<{ ok: true } | Fail> {
  const admin = adminClient();
  if ("error" in admin) return fail(500, "server_error", "Something went wrong.");
  const contact = await admin.client.from("contacts").select("id").eq("id", contactId).maybeSingle();
  if (contact.error) {
    console.error("[missio] contact lookup failed", contact.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!contact.data) return NOT_MISSIO;
  const inserted = await admin.client.from("org_people").insert({
    org_id: auth.orgId,
    contact_id: contactId,
    campus,
    status: "active",
    created_by: auth.user.id,
  });
  if (inserted.error && inserted.error.code !== "23505") {
    console.error("[missio] org_people insert failed", inserted.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  await audit(admin.client, {
    userId: auth.user.id,
    action: "missio.import_review_add_person",
    resourceType: "contact",
    resourceId: contactId,
    changes: { campus, source: "import_review_link" },
  });
  return { ok: true };
}

function suggestedCandidates(ids: string[], refs: Map<string, PersonRef>): PersonRef[] {
  const seen = new Set<string>();
  const candidates: PersonRef[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ref = refs.get(id);
    if (!ref) continue;
    candidates.push(ref);
    if (candidates.length === 5) break;
  }
  return candidates;
}

function refFor(map: Map<string, PersonRef>, contactId: string): PersonRef {
  return map.get(contactId) ?? { contactId, displayName: "", firstName: null, lastName: null };
}

function memberView(row: MemberRow, map: Map<string, PersonRef>, orgPersonId?: string): HouseChurchMemberView | null {
  const role = asRole(row.role);
  if (!role) return null;
  const ref = refFor(map, row.contact_id);
  const view: HouseChurchMemberView = {
    ...ref,
    role,
    startedAt: (row.started_at ?? "").slice(0, 10),
    leftMissio: false,
  };
  if (orgPersonId) view.orgPersonId = orgPersonId;
  else if (!ref.orgPersonId) delete view.orgPersonId;
  return view;
}

function compareMembers(a: HouseChurchMemberView, b: HouseChurchMemberView): number {
  return (
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    (a.displayName ?? "").localeCompare(b.displayName ?? "", "en") ||
    a.contactId.localeCompare(b.contactId)
  );
}

function compareNames(a: PersonRef, b: PersonRef): number {
  return a.displayName.localeCompare(b.displayName, "en") || a.contactId.localeCompare(b.contactId);
}

function asPersonRef(member: HouseChurchMemberView): PersonRef {
  const ref: PersonRef = {
    contactId: member.contactId,
    displayName: member.displayName ?? "",
    firstName: member.firstName,
    lastName: member.lastName,
  };
  if (member.orgPersonId) ref.orgPersonId = member.orgPersonId;
  return ref;
}

function summaryFrom(house: HouseRow, members: HouseChurchMemberView[]): HouseChurchSummary {
  return {
    id: house.id,
    number: Number(house.number),
    name: blankToNull(house.name),
    campus: asCampus(house.campus),
    meetingDay: blankToNull(house.meeting_day),
    location: blankToNull(house.location),
    memberCount: members.length,
    leaders: members.filter((member) => member.role === "leader").map(asPersonRef).sort(compareNames),
    coLeaders: members.filter((member) => member.role === "co_leader").map(asPersonRef).sort(compareNames),
  };
}

async function loadHouse(
  auth: OrgAccess,
  scope: HouseScope,
  houseId: string
): Promise<{ ok: true; house: HouseRow } | Fail> {
  let query = auth.supabase.from("house_churches").select(HOUSE_COLUMNS).eq("id", houseId).eq("org_id", auth.orgId);
  query = restrictHouseQuery(query, scope);
  if (!query) return fail(404, "not_found", "House not found.");
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[missio] house read failed", error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!data || !houseInScope(scope, (data as HouseRow).id)) return fail(404, "not_found", "House not found.");
  return { ok: true, house: data as HouseRow };
}

async function loadHouseByNumber(
  auth: OrgAccess,
  scope: HouseScope,
  houseNumber: number
): Promise<{ ok: true; house: HouseRow } | Fail> {
  let query = auth.supabase
    .from("house_churches")
    .select(HOUSE_COLUMNS)
    .eq("org_id", auth.orgId)
    .eq("number", houseNumber);
  query = restrictHouseQuery(query, scope);
  if (!query) return fail(404, "not_found", "House not found.");
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[missio] house read failed", error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!data || !houseInScope(scope, (data as HouseRow).id)) return fail(404, "not_found", "House not found.");
  return { ok: true, house: data as HouseRow };
}

function asMembership(row: MemberRow) {
  return { startedAt: row.started_at, endedAt: row.ended_at };
}

async function missioContactIds(auth: OrgAccess, contactIds: string[]): Promise<{ ok: true; ids: Set<string> } | Fail> {
  const ids = [...new Set(contactIds)];
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const people = await auth.supabase
      .from("org_people")
      .select("contact_id")
      .eq("org_id", auth.orgId)
      .in("contact_id", slice);
    if (people.error) {
      console.error("[missio] org person lookup failed", people.error.message);
      return fail(500, "server_error", "Something went wrong.");
    }
    for (const row of (people.data ?? []) as Array<{ contact_id?: string }>) {
      if (row.contact_id) found.add(row.contact_id);
    }
  }
  return { ok: true, ids: found };
}

function currentMembers(rows: MemberRow[], inMissio: ReadonlySet<string>, today = todayIsoDate()): MemberRow[] {
  return rows.filter(
    (row) => inMissio.has(row.contact_id) && membershipIsCurrent(asMembership(row), today)
  );
}

/** Open rows whose contact is no longer in org_people. Names are not loaded. */
function leftMissioMembers(rows: MemberRow[], inMissio: ReadonlySet<string>): HouseChurchMemberView[] {
  const views: HouseChurchMemberView[] = [];
  for (const row of rows) {
    if (inMissio.has(row.contact_id) || !membershipIsOpen(asMembership(row))) continue;
    const role = asRole(row.role);
    if (!role) continue;
    views.push({
      contactId: row.contact_id,
      displayName: null,
      firstName: null,
      lastName: null,
      role,
      startedAt: (row.started_at ?? "").slice(0, 10),
      leftMissio: true,
    });
  }
  return views;
}

/** The open row (ended_at IS NULL). A second open row is what the unique index rejects. */
function blockingMember(rows: MemberRow[]): MemberRow | null {
  return rows.find((row) => membershipBlocksInsert(asMembership(row))) ?? null;
}

/** PATCH and DELETE on a row that has already ended. No row at all stays not_found. */
function closedMembership(rows: MemberRow[]): Fail {
  if (rows.some((row) => row.ended_at)) {
    return fail(409, "membership_not_current", "This membership has already ended.");
  }
  return fail(404, "not_found", "Member not found.");
}

async function memberRowsFor(
  auth: OrgAccess,
  houseId: string,
  contactId: string
): Promise<{ ok: true; rows: MemberRow[] } | Fail> {
  const { data, error } = await auth.supabase
    .from("house_church_members")
    .select(MEMBER_COLUMNS)
    .eq("house_church_id", houseId)
    .eq("contact_id", contactId);
  if (error) {
    console.error("[missio] member read failed", error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  return { ok: true, rows: (data ?? []) as MemberRow[] };
}

/** null or omitted means today. A date after the UTC database date is invalid_input. */
function startDateForWrite(value: string | null | undefined): { ok: true; startedAt: string } | Fail {
  if (value == null || value === "") return { ok: true, startedAt: todayIsoDate() };
  if (isAfterDatabaseToday(value)) {
    return fail(400, "invalid_input", "Check the fields and try again.", fieldError("startedAt"));
  }
  return { ok: true, startedAt: value.slice(0, 10) };
}

async function insertMember(
  auth: OrgAccess,
  admin: Client,
  house: HouseRow,
  contact: ContactNameRow,
  role: HouseChurchRole,
  orgPersonId: string,
  startedAt: string
): Promise<{ ok: true; member: HouseChurchMemberView; memberId: string } | Fail> {
  const inserted = await auth.supabase
    .from("house_church_members")
    .insert({
      house_church_id: house.id,
      contact_id: contact.id,
      role,
      started_at: startedAt,
      ended_at: null,
      // Pastor routes set created_by to the signed-in user. Migration 331
      // keeps that value for a service-role write (auth.uid() is null) and
      // overwrites it with auth.uid() when the caller is signed in.
      created_by: auth.user.id,
    })
    .select(MEMBER_COLUMNS)
    .maybeSingle();
  if (inserted.error) return dbWriteError(inserted.error, "membership write");
  const row = inserted.data as MemberRow | null;
  if (!row?.id) return fail(500, "server_error", "Something went wrong.");

  await audit(admin, {
    userId: auth.user.id,
    action: "missio.house_member_add",
    resourceType: "house_church_member",
    resourceId: row.id,
    changes: {
      houseChurchId: house.id,
      contactId: contact.id,
      role,
      orgPersonCreated: false,
    },
  });

  const ref = toPersonRef(contact, orgPersonId);
  return {
    ok: true,
    memberId: row.id,
    member: { ...ref, role, startedAt: (row.started_at ?? todayIsoDate()).slice(0, 10), leftMissio: false },
  };
}

export async function listHouses(
  auth: OrgAccess,
  scope: HouseScope
): Promise<{ ok: true; body: HouseChurchListResponse } | Fail> {
  let query = auth.supabase
    .from("house_churches")
    .select(HOUSE_COLUMNS)
    .eq("org_id", auth.orgId)
    .order("number", { ascending: true });
  query = restrictHouseQuery(query, scope);
  if (!query) return { ok: true, body: { houses: [], canWrite: true } };

  const houses = await query;
  if (houses.error) {
    console.error("[missio] house list failed", houses.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const houseRows = ((houses.data ?? []) as HouseRow[]).filter((house) => houseInScope(scope, house.id));
  const membersByHouse = new Map<string, HouseChurchMemberView[]>();
  if (houseRows.length === 0) return { ok: true, body: { houses: [], canWrite: true } };

  const memberRes = await auth.supabase
    .from("house_church_members")
    .select(MEMBER_COLUMNS)
    .in(
      "house_church_id",
      houseRows.map((house) => house.id)
    );
  if (memberRes.error) {
    console.error("[missio] member list failed", memberRes.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const rawMembers = (memberRes.data ?? []) as MemberRow[];
  const inMissio = await missioContactIds(auth, rawMembers.map((row) => row.contact_id));
  if (!inMissio.ok) return inMissio;
  const memberRows = currentMembers(rawMembers, inMissio.ids);
  const contactIds = memberRows.map((row) => row.contact_id);
  let refs = new Map<string, PersonRef>();
  if (contactIds.length > 0) {
    const loaded = await loadRefs(auth, contactIds);
    if (isFail(loaded)) return loaded;
    refs = loaded;
  }

  for (const row of memberRows) {
    const view = memberView(row, refs);
    if (!view) continue;
    const list = membersByHouse.get(row.house_church_id) ?? [];
    list.push(view);
    membersByHouse.set(row.house_church_id, list);
  }

  const body: HouseChurchListResponse = {
    canWrite: true,
    houses: houseRows.map((house) => summaryFrom(house, membersByHouse.get(house.id) ?? [])),
  };
  return { ok: true, body };
}

export async function getHouse(
  auth: OrgAccess,
  scope: HouseScope,
  houseId: string
): Promise<{ ok: true; body: HouseChurchDetailResponse } | Fail> {
  const loaded = await loadHouse(auth, scope, houseId);
  if (!loaded.ok) return loaded;

  const memberRes = await auth.supabase
    .from("house_church_members")
    .select(MEMBER_COLUMNS)
    .eq("house_church_id", loaded.house.id);
  if (memberRes.error) {
    console.error("[missio] member list failed", memberRes.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const rawMembers = (memberRes.data ?? []) as MemberRow[];
  const inMissio = await missioContactIds(auth, rawMembers.map((row) => row.contact_id));
  if (!inMissio.ok) return inMissio;
  const memberRows = currentMembers(rawMembers, inMissio.ids);
  let refs = new Map<string, PersonRef>();
  if (memberRows.length > 0) {
    const names = await loadRefs(auth, memberRows.map((row) => row.contact_id));
    if (isFail(names)) return names;
    refs = names;
  }

  const members = [
    ...memberRows
      .map((row) => memberView(row, refs))
      .filter((member): member is HouseChurchMemberView => Boolean(member)),
    ...leftMissioMembers(rawMembers, inMissio.ids),
  ].sort(compareMembers);
  const house: HouseChurchDetail = {
    ...summaryFrom(loaded.house, members.filter((member) => !member.leftMissio)),
    leaderNotes: blankToNull(loaded.house.leader_notes),
    members,
  };
  return { ok: true, body: { house, canWrite: true } };
}

export async function addMember(
  auth: OrgAccess,
  scope: HouseScope,
  houseId: string,
  body: unknown
): Promise<{ ok: true; status: 201; member: HouseChurchMemberView } | Fail> {
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) return zodFail(parsed.error);
  const started = startDateForWrite(parsed.data.startedAt);
  if (!started.ok) return started;

  const person = await requireMissioPerson(auth, parsed.data.contactId);
  if (!person.ok) return person;
  const house = await loadHouse(auth, scope, houseId);
  if (!house.ok) return house;
  const existing = await memberRowsFor(auth, house.house.id, parsed.data.contactId);
  if (!existing.ok) return existing;
  if (blockingMember(existing.rows)) return fail(409, "already_member", "This person is already in this house.");

  const admin = adminClient();
  if ("error" in admin) return fail(500, "server_error", admin.error);
  const inserted = await insertMember(
    auth,
    admin.client,
    house.house,
    person.contact,
    parsed.data.role,
    person.orgPersonId,
    started.startedAt
  );
  if (!inserted.ok) return inserted;
  return { ok: true, status: 201, member: inserted.member };
}

export async function changeMemberRole(
  auth: OrgAccess,
  scope: HouseScope,
  houseId: string,
  contactId: string,
  body: unknown
): Promise<{ ok: true; member: HouseChurchMemberView } | Fail> {
  if (!isUuid(contactId)) return fail(404, "not_found", "Member not found.");
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) return zodFail(parsed.error);

  const house = await loadHouse(auth, scope, houseId);
  if (!house.ok) return house;

  const existing = await memberRowsFor(auth, house.house.id, contactId);
  if (!existing.ok) return existing;
  const target = blockingMember(existing.rows);
  if (!target) return closedMembership(existing.rows);

  const person = await requireMissioPerson(auth, contactId);
  if (!person.ok) {
    if (person.code === "not_missio_person") {
      return fail(409, "member_left_missio", MEMBER_LEFT_MISSIO_MESSAGE);
    }
    return person;
  }

  const updated = await auth.supabase
    .from("house_church_members")
    .update({ role: parsed.data.role })
    .eq("id", target.id)
    .eq("house_church_id", house.house.id)
    .select(MEMBER_COLUMNS)
    .maybeSingle();
  if (updated.error) return dbWriteError(updated.error, "membership write");
  const row = updated.data as MemberRow | null;
  if (!row) return fail(404, "not_found", "Member not found.");

  const names = await loadRefs(auth, [contactId]);
  if (isFail(names)) return names;
  const view = memberView(row, names);
  if (!view) return fail(500, "server_error", "Something went wrong.");
  view.orgPersonId = person.orgPersonId;

  const admin = adminClient();
  if ("error" in admin) return fail(500, "server_error", admin.error);
  await audit(admin.client, {
    userId: auth.user.id,
    action: "missio.house_member_role",
    resourceType: "house_church_member",
    resourceId: row.id,
    changes: { houseChurchId: house.house.id, contactId, role: parsed.data.role },
  });
  return { ok: true, member: view };
}

export async function endMember(
  auth: OrgAccess,
  scope: HouseScope,
  houseId: string,
  contactId: string
): Promise<{ ok: true } | Fail> {
  if (!isUuid(contactId)) return fail(404, "not_found", "Member not found.");
  // Pastor access is already required by the route. ended_at is the UTC
  // database date. At c587e497 the guard does not re-check org_people when
  // a membership ends, so someone who has left Missio can still be closed.
  const house = await loadHouse(auth, scope, houseId);
  if (!house.ok) return house;

  const existing = await memberRowsFor(auth, house.house.id, contactId);
  if (!existing.ok) return existing;
  const target = blockingMember(existing.rows);
  if (!target) return closedMembership(existing.rows);

  const endedAt = endDateFor();
  const updated = await auth.supabase
    .from("house_church_members")
    .update({ ended_at: endedAt })
    .eq("id", target.id)
    .eq("house_church_id", house.house.id)
    .select("id")
    .maybeSingle();
  if (updated.error) {
    const mapped = mapMembershipEndError(updated.error);
    console.error("[missio] membership end failed", updated.error.code ?? "write failed");
    return fail(mapped.status, mapped.code, mapped.error, mapped.fieldErrors);
  }
  if (!updated.data?.id) return fail(404, "not_found", "Member not found.");

  const admin = adminClient();
  if ("error" in admin) return fail(500, "server_error", admin.error);
  await audit(admin.client, {
    userId: auth.user.id,
    action: "missio.house_member_end",
    resourceType: "house_church_member",
    resourceId: updated.data.id as string,
    changes: { houseChurchId: house.house.id, contactId, endedAt },
  });
  return { ok: true };
}

function toReviewItem(row: ReviewRow, house: HouseRow | null, candidates: PersonRef[]): ImportReviewItem | null {
  const status = asReviewStatus(row.status);
  const role = asRole(row.role);
  if (!status || !role) return null;
  return {
    id: row.id,
    status,
    sourceLine: Number(row.source_line),
    rawName: row.raw_name,
    kind: blankToNull(row.kind),
    note: blankToNull(row.notes),
    matchType: blankToNull(row.match_type),
    houseNumber: Number(row.house_number),
    house: house ? { id: house.id, number: Number(house.number), name: blankToNull(house.name) } : null,
    role,
    candidates,
  };
}

export async function listImportReview(
  auth: OrgAccess,
  scope: HouseScope,
  status: ImportReviewStatus | "all"
): Promise<{ ok: true; body: ImportReviewListResponse } | Fail> {
  let request = auth.supabase
    .from("missio_import_review")
    .select(REVIEW_COLUMNS)
    .eq("org_id", auth.orgId)
    .order("source_line", { ascending: true })
    .order("raw_name", { ascending: true });
  if (status !== "all") request = request.eq("status", status);
  const reviewed = await request;
  if (reviewed.error) {
    console.error("[missio] import review list failed", reviewed.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }

  let houseQuery = auth.supabase.from("house_churches").select(HOUSE_COLUMNS).eq("org_id", auth.orgId);
  houseQuery = restrictHouseQuery(houseQuery, scope);
  const houses = houseQuery ? await houseQuery : { data: [], error: null };
  if (houses.error) {
    console.error("[missio] house list failed", houses.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const byNumber = new Map<number, HouseRow>();
  for (const house of (houses.data ?? []) as HouseRow[]) {
    if (houseInScope(scope, house.id)) byNumber.set(Number(house.number), house);
  }

  const rows = (reviewed.data ?? []) as ReviewRow[];
  const visible = rows.filter((row) => {
    const house = byNumber.get(Number(row.house_number));
    if (scope.mode === "all") return true;
    return Boolean(house && houseInScope(scope, house.id));
  });

  const candidateIds = visible.flatMap((row) => (row.candidate_contact_ids ?? []).slice(0, 5));
  let refs = new Map<string, PersonRef>();
  if (candidateIds.length > 0) {
    const loaded = await loadReviewRefs(auth, candidateIds);
    if (isFail(loaded)) return loaded;
    refs = loaded;
  }

  const items: ImportReviewItem[] = [];
  for (const row of visible) {
    const ids = (row.candidate_contact_ids ?? []).slice(0, 5);
    const candidates = suggestedCandidates(ids, refs);
    const item = toReviewItem(row, byNumber.get(Number(row.house_number)) ?? null, candidates);
    if (item) items.push(item);
  }
  return { ok: true, body: { items } };
}

async function loadReview(auth: OrgAccess, itemId: string): Promise<{ ok: true; row: ReviewRow } | Fail> {
  const { data, error } = await auth.supabase
    .from("missio_import_review")
    .select(REVIEW_COLUMNS)
    .eq("id", itemId)
    .eq("org_id", auth.orgId)
    .maybeSingle();
  if (error) {
    console.error("[missio] import review read failed", error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!data) return fail(404, "not_found", "Review item not found.");
  return { ok: true, row: data as ReviewRow };
}

async function attachKnownMember(
  auth: OrgAccess,
  admin: Client,
  house: HouseRow,
  person: { orgPersonId: string; contact: ContactNameRow },
  role: HouseChurchRole
): Promise<{ ok: true; member: HouseChurchMemberView } | Fail> {
  const existing = await memberRowsFor(auth, house.id, person.contact.id);
  if (!existing.ok) return existing;
  const held = blockingMember(existing.rows);
  if (held) {
    const view = memberView(held, new Map([[person.contact.id, toPersonRef(person.contact, person.orgPersonId)]]));
    if (!view) return fail(500, "server_error", "Something went wrong.");
    view.orgPersonId = person.orgPersonId;
    return { ok: true, member: view };
  }
  const inserted = await insertMember(auth, admin, house, person.contact, role, person.orgPersonId, todayIsoDate());
  if (!inserted.ok) return inserted;
  return { ok: true, member: inserted.member };
}

async function claimReview(
  auth: OrgAccess,
  itemId: string,
  patch: { status: "matched" | "new" | "skipped"; contactId: string | null; notes?: string | null }
): Promise<{ ok: true; row: ReviewRow } | Fail> {
  // resolved_at is not sent. Migration 331 sets it to now() when a contact
  // is resolved. resolved_by is the signed-in pastor; the trigger pins it
  // to auth.uid() when that is set, and a service-role write would keep
  // whatever value was passed.
  const update: Partial<Record<(typeof REVIEW_RESOLVE_COLUMNS)[number], unknown>> = {
    status: patch.status,
    resolved_contact_id: patch.contactId,
    resolved_by: auth.user.id,
  };
  if (patch.notes !== undefined) update.notes = patch.notes;
  const updated = await auth.supabase
    .from("missio_import_review")
    .update(update)
    .eq("id", itemId)
    .eq("org_id", auth.orgId)
    .eq("status", "pending")
    .select(REVIEW_COLUMNS)
    .maybeSingle();
  if (updated.error) return dbWriteError(updated.error, "import review update");
  if (!updated.data) return fail(409, "already_resolved", "This row is already resolved.");
  return { ok: true, row: updated.data as ReviewRow };
}

async function releaseReview(
  auth: OrgAccess,
  itemId: string,
  status: "matched" | "new" | "skipped",
  clearNotes = false
) {
  const update: Partial<Record<(typeof REVIEW_RESOLVE_COLUMNS)[number], unknown>> = {
    status: "pending",
    resolved_contact_id: null,
    resolved_by: null,
    resolved_at: null,
  };
  if (clearNotes) update.notes = null;
  const released = await auth.supabase
    .from("missio_import_review")
    .update(update)
    .eq("id", itemId)
    .eq("org_id", auth.orgId)
    .eq("status", status)
    .eq("resolved_by", auth.user.id);
  if (released.error) console.error("[missio] import review release failed", released.error.code ?? "update failed");
}

async function shapeClaimedReview(
  auth: OrgAccess,
  admin: Client,
  row: ReviewRow,
  house: HouseRow | null,
  member: HouseChurchMemberView | undefined,
  action: "link" | "create" | "skip",
  also = false
): Promise<{ ok: true; body: ResolveImportReviewResponse } | Fail> {
  await audit(admin, {
    userId: auth.user.id,
    action: also ? "missio.import_review_add_also" : "missio.import_review_resolve",
    resourceType: "missio_import_review",
    resourceId: row.id,
    changes: {
      action,
      status: row.status,
      contactId: also ? member?.contactId ?? null : row.resolved_contact_id,
      houseNumber: row.house_number,
      orgPersonCreated: action === "create",
    },
  });
  const ids = (row.candidate_contact_ids ?? []).slice(0, 5);
  const refs = ids.length > 0 ? await loadReviewRefs(auth, ids) : new Map<string, PersonRef>();
  if (isFail(refs)) return refs;
  const shaped = toReviewItem(row, house, suggestedCandidates(ids, refs));
  if (!shaped) return fail(500, "server_error", "Something went wrong.");
  const body: ResolveImportReviewResponse = { item: shaped };
  if (member) body.member = member;
  return { ok: true, body };
}

export async function resolveImportReview(
  auth: OrgAccess,
  scope: HouseScope,
  itemId: string,
  body: unknown
): Promise<{ ok: true; body: ResolveImportReviewResponse } | Fail> {
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) return zodFail(parsed.error);

  const loaded = await loadReview(auth, itemId);
  if (!loaded.ok) return loaded;
  // One sheet name can stand for two people ("Botha" for a couple). Once a
  // row is linked or created, `also` adds another person to the same house
  // in the same role. The row keeps its first resolved contact.
  const status = loaded.row.status;
  const also =
    parsed.data.action !== "skip" && parsed.data.also === true && (status === "matched" || status === "new");
  if (status !== "pending" && !also) return fail(409, "already_resolved", "This row is already resolved.");
  const role = asRole(loaded.row.role);
  if (!role) return fail(500, "server_error", "Something went wrong.");

  if (also && parsed.data.action !== "skip") {
    const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
    if (!house.ok) return house;
    const admin = adminClient();
    if ("error" in admin) return fail(500, "server_error", "Something went wrong.");
    let contactId: string;
    if (parsed.data.action === "link") {
      contactId = parsed.data.contactId;
      const known = await requireMissioPerson(auth, contactId);
      if (!known.ok && known.status !== 400) return known;
      if (!known.ok) {
        const added = await ensureMissioPerson(auth, contactId, asCampus(house.house.campus));
        if (!added.ok) return added;
      }
    } else {
      const name = [parsed.data.firstName, emptyToUndefined(parsed.data.lastName)].filter(Boolean).join(" ");
      const created = await createPerson(auth, {
        name,
        email: emptyToUndefined(parsed.data.email),
        phone: emptyToUndefined(parsed.data.phone),
        campus: asCampus(house.house.campus),
      });
      if (!created.ok) return fromPersonError(created.status, created.code);
      contactId = created.body.person.contactId;
    }
    const person = await requireMissioPerson(auth, contactId);
    if (!person.ok) return person;
    const attached = await attachKnownMember(auth, admin.client, house.house, person, role);
    if (!attached.ok) return attached;
    return shapeClaimedReview(auth, admin.client, loaded.row, house.house, attached.member, parsed.data.action, true);
  }

  if (parsed.data.action === "link") {
    let person = await requireMissioPerson(auth, parsed.data.contactId);
    if (!person.ok && person.status !== 400) return person;
    if (!person.ok) {
      // The sheet is the source of Missio people, so linking a contact who
      // is not in Missio yet adds them first. This runs before the claim:
      // the 331 guard only lets a review row resolve to a staged candidate
      // or an org_people contact. A contact that does not exist is refused.
      const target = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
      if (!target.ok) return target;
      const added = await ensureMissioPerson(auth, parsed.data.contactId, asCampus(target.house.campus));
      if (!added.ok) return added;
      person = await requireMissioPerson(auth, parsed.data.contactId);
      if (!person.ok) return person;
    }
    const claimed = await claimReview(auth, itemId, { status: "matched", contactId: parsed.data.contactId });
    if (!claimed.ok) return claimed;
    const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
    if (!house.ok) {
      await releaseReview(auth, itemId, "matched");
      return house;
    }
    const admin = adminClient();
    if ("error" in admin) {
      await releaseReview(auth, itemId, "matched");
      return fail(500, "server_error", "Something went wrong.");
    }
    const attached = await attachKnownMember(auth, admin.client, house.house, person, role);
    if (!attached.ok) {
      await releaseReview(auth, itemId, "matched");
      return attached;
    }
    return shapeClaimedReview(auth, admin.client, claimed.row, house.house, attached.member, "link");
  }

  if (parsed.data.action === "skip") {
    const claimed = await claimReview(auth, itemId, {
      status: "skipped",
      contactId: null,
      notes: parsed.data.notes === undefined ? undefined : emptyToUndefined(parsed.data.notes) ?? null,
    });
    if (!claimed.ok) return claimed;
    const admin = adminClient();
    if ("error" in admin) {
      await releaseReview(auth, itemId, "skipped", true);
      return fail(500, "server_error", "Something went wrong.");
    }
    const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
    if (!house.ok && (house.status !== 404 || scope.mode !== "all")) {
      await releaseReview(auth, itemId, "skipped", true);
      return house;
    }
    return shapeClaimedReview(auth, admin.client, claimed.row, house.ok ? house.house : null, undefined, "skip");
  }

  const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
  if (!house.ok) return house;
  const claimed = await claimReview(auth, itemId, { status: "new", contactId: null });
  if (!claimed.ok) return claimed;

  const name = [parsed.data.firstName, emptyToUndefined(parsed.data.lastName)].filter(Boolean).join(" ");
  const created = await createPerson(auth, {
    name,
    email: emptyToUndefined(parsed.data.email),
    phone: emptyToUndefined(parsed.data.phone),
    campus: asCampus(house.house.campus),
  });
  if (!created.ok) {
    await releaseReview(auth, itemId, "new");
    return fromPersonError(created.status, created.code);
  }
  const person = await requireMissioPerson(auth, created.body.person.contactId);
  if (!person.ok) {
    await releaseReview(auth, itemId, "new");
    return person;
  }
  const admin = adminClient();
  if ("error" in admin) {
    await releaseReview(auth, itemId, "new");
    return fail(500, "server_error", "Something went wrong.");
  }
  const stamped = await auth.supabase
    .from("missio_import_review")
    .update({ resolved_contact_id: person.contact.id })
    .eq("id", itemId)
    .eq("org_id", auth.orgId)
    .eq("status", "new")
    .select(REVIEW_COLUMNS)
    .maybeSingle();
  if (stamped.error) {
    await releaseReview(auth, itemId, "new");
    return dbWriteError(stamped.error, "import review contact stamp");
  }
  if (!stamped.data) {
    await releaseReview(auth, itemId, "new");
    return fail(500, "server_error", "Something went wrong.");
  }
  const attached = await attachKnownMember(auth, admin.client, house.house, person, role);
  if (!attached.ok) {
    await releaseReview(auth, itemId, "new");
    return attached;
  }
  return shapeClaimedReview(auth, admin.client, stamped.data as ReviewRow, house.house, attached.member, "create");
}
