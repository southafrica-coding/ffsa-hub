import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole, type OrgAccess } from "@/lib/missio/access";
import { membershipBlocksInsert, membershipIsCurrent, membershipIsOpen } from "@/lib/missio/house-church-import";
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
  MissioErrorCode,
  PersonRef,
  ResolveImportReviewResponse,
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
// Candidate suggestions are limited to people who have that row. Ending a
// membership sets ended_at to today and never changes org_people. A current
// membership is an open row (ended_at IS NULL) whose started_at is on or
// before today. ended_at after today is rejected by the database.
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

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };

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

function fail(status: number, code: MissioErrorCode, error: string): Fail {
  return { ok: false, status, code, error };
}

function isFail(value: Map<string, PersonRef> | Fail): value is Fail {
  return "ok" in value && value.ok === false;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Calendar date in UTC. toISOString is UTC, so this is not the SAST civil date near midnight. */
export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

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

const addMemberSchema = z
  .object({
    contactId: z.string().uuid(),
    role: z.enum(ROLES),
  })
  .strict();

const roleSchema = z.object({ role: z.enum(ROLES) }).strict();

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), contactId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("create"),
      firstName: z.string().trim().min(1).max(200),
      lastName: z.string().trim().max(200).nullable().optional(),
      email: z.string().trim().email().max(320).nullable().optional(),
      phone: z.string().trim().min(1).max(40).nullable().optional(),
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

/** 23514 missio_ended_at_in_future (migration 331) is a conflict, not a 500. */
function membershipWriteError(error: { code?: string; message?: string }): Fail {
  if (error.code === "23505") return fail(409, "already_member", "This person is already in this house.");
  if (error.code === "23514") return fail(409, "invalid_input", "Check the fields and try again.");
  if (error.code === "23503") return NOT_MISSIO;
  console.error("[missio] membership write failed", error.message ?? error.code ?? "write failed");
  return fail(500, "server_error", "Something went wrong.");
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

function suggestedCandidates(ids: string[], refs: Map<string, PersonRef>): PersonRef[] {
  const seen = new Set<string>();
  const candidates: PersonRef[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ref = refs.get(id);
    if (!ref?.orgPersonId) continue;
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
  };
  if (orgPersonId) view.orgPersonId = orgPersonId;
  else if (!ref.orgPersonId) delete view.orgPersonId;
  return view;
}

function compareMembers(a: HouseChurchMemberView, b: HouseChurchMemberView): number {
  return (
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    a.displayName.localeCompare(b.displayName, "en") ||
    a.contactId.localeCompare(b.contactId)
  );
}

function compareNames(a: PersonRef, b: PersonRef): number {
  return a.displayName.localeCompare(b.displayName, "en") || a.contactId.localeCompare(b.contactId);
}

function asPersonRef(member: HouseChurchMemberView): PersonRef {
  const ref: PersonRef = {
    contactId: member.contactId,
    displayName: member.displayName,
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

/** The open row (ended_at IS NULL). A second open row is what the unique index rejects. */
function blockingMember(rows: MemberRow[]): MemberRow | null {
  return rows.find((row) => membershipBlocksInsert(asMembership(row))) ?? null;
}

function endDateFor(row: MemberRow, today = todayIsoDate()): string | null {
  const started = (row.started_at ?? today).slice(0, 10);
  if (started > today) return null;
  return today;
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

async function insertMember(
  auth: OrgAccess,
  admin: Client,
  house: HouseRow,
  contact: ContactNameRow,
  role: HouseChurchRole,
  orgPersonId: string
): Promise<{ ok: true; member: HouseChurchMemberView; memberId: string } | Fail> {
  const inserted = await auth.supabase
    .from("house_church_members")
    .insert({
      house_church_id: house.id,
      contact_id: contact.id,
      role,
      started_at: todayIsoDate(),
      ended_at: null,
      created_by: auth.user.id,
    })
    .select(MEMBER_COLUMNS)
    .maybeSingle();
  if (inserted.error) return membershipWriteError(inserted.error);
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
    member: { ...ref, role, startedAt: (row.started_at ?? todayIsoDate()).slice(0, 10) },
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

  const members = memberRows
    .map((row) => memberView(row, refs))
    .filter((member): member is HouseChurchMemberView => Boolean(member))
    .sort(compareMembers);
  const house: HouseChurchDetail = {
    ...summaryFrom(loaded.house, members),
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
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");

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
    person.orgPersonId
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
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");

  const house = await loadHouse(auth, scope, houseId);
  if (!house.ok) return house;
  const person = await requireMissioPerson(auth, contactId);
  if (!person.ok) return person;

  const existing = await memberRowsFor(auth, house.house.id, contactId);
  if (!existing.ok) return existing;
  const target = blockingMember(existing.rows);
  if (!target) return fail(404, "not_found", "Member not found.");

  const updated = await auth.supabase
    .from("house_church_members")
    .update({ role: parsed.data.role })
    .eq("id", target.id)
    .eq("house_church_id", house.house.id)
    .select(MEMBER_COLUMNS)
    .maybeSingle();
  if (updated.error) return membershipWriteError(updated.error);
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
  const house = await loadHouse(auth, scope, houseId);
  if (!house.ok) return house;

  const existing = await memberRowsFor(auth, house.house.id, contactId);
  if (!existing.ok) return existing;
  const target = blockingMember(existing.rows);
  if (!target) return fail(404, "not_found", "Member not found.");

  const endedAt = endDateFor(target);
  if (!endedAt) return fail(400, "invalid_input", "Check the fields and try again.");
  const updated = await auth.supabase
    .from("house_church_members")
    .update({ ended_at: endedAt })
    .eq("id", target.id)
    .eq("house_church_id", house.house.id)
    .select("id")
    .maybeSingle();
  if (updated.error) return membershipWriteError(updated.error);
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
    matchType: blankToNull(row.match_type),
    houseNumber: Number(row.house_number),
    house: house ? { id: house.id, number: Number(house.number), name: blankToNull(house.name) } : null,
    role,
    candidates,
    notes: blankToNull(row.notes),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
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
    const loaded = await loadRefs(auth, candidateIds);
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
  const inserted = await insertMember(auth, admin, house, person.contact, role, person.orgPersonId);
  if (!inserted.ok) return inserted;
  return { ok: true, member: inserted.member };
}

async function claimReview(
  auth: OrgAccess,
  itemId: string,
  patch: { status: "matched" | "new" | "skipped"; contactId: string | null; notes?: string | null }
): Promise<{ ok: true; row: ReviewRow } | Fail> {
  const update: Partial<Record<(typeof REVIEW_RESOLVE_COLUMNS)[number], unknown>> = {
    status: patch.status,
    resolved_contact_id: patch.contactId,
    resolved_by: auth.user.id,
    resolved_at: new Date().toISOString(),
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
  if (updated.error) {
    console.error("[missio] import review update failed", updated.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!updated.data) return fail(409, "already_resolved", "This row is already resolved.");
  return { ok: true, row: updated.data as ReviewRow };
}

async function releaseReview(auth: OrgAccess, itemId: string) {
  const released = await auth.supabase
    .from("missio_import_review")
    .update({
      status: "pending",
      resolved_contact_id: null,
      resolved_by: null,
      resolved_at: null,
    })
    .eq("id", itemId)
    .eq("org_id", auth.orgId);
  if (released.error) console.error("[missio] import review release failed", released.error.message);
}

async function shapeClaimedReview(
  auth: OrgAccess,
  admin: Client,
  row: ReviewRow,
  house: HouseRow | null,
  member: HouseChurchMemberView | undefined,
  action: "link" | "create" | "skip"
): Promise<{ ok: true; body: ResolveImportReviewResponse } | Fail> {
  await audit(admin, {
    userId: auth.user.id,
    action: "missio.import_review_resolve",
    resourceType: "missio_import_review",
    resourceId: row.id,
    changes: {
      action,
      status: row.status,
      contactId: row.resolved_contact_id,
      houseNumber: row.house_number,
      orgPersonCreated: action === "create",
    },
  });
  const ids = (row.candidate_contact_ids ?? []).slice(0, 5);
  const refs = ids.length > 0 ? await loadRefs(auth, ids) : new Map<string, PersonRef>();
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
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");

  const loaded = await loadReview(auth, itemId);
  if (!loaded.ok) return loaded;
  if (loaded.row.status !== "pending") return fail(409, "already_resolved", "This row is already resolved.");
  const role = asRole(loaded.row.role);
  if (!role) return fail(500, "server_error", "Something went wrong.");

  if (parsed.data.action === "link") {
    const candidates = loaded.row.candidate_contact_ids ?? [];
    const person = await requireMissioPerson(auth, parsed.data.contactId);
    if (!person.ok && person.status !== 400) return person;
    if (!person.ok && !candidates.includes(parsed.data.contactId)) return NOT_MISSIO;
    const claimed = await claimReview(auth, itemId, { status: "matched", contactId: parsed.data.contactId });
    if (!claimed.ok) return claimed;
    if (!person.ok) {
      const admin = adminClient();
      if ("error" in admin) return fail(500, "server_error", admin.error);
      const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
      return shapeClaimedReview(auth, admin.client, claimed.row, house.ok ? house.house : null, undefined, "link");
    }
    const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
    if (!house.ok) {
      await releaseReview(auth, itemId);
      return house;
    }
    const admin = adminClient();
    if ("error" in admin) {
      await releaseReview(auth, itemId);
      return fail(500, "server_error", admin.error);
    }
    const attached = await attachKnownMember(auth, admin.client, house.house, person, role);
    if (!attached.ok) {
      await releaseReview(auth, itemId);
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
    if ("error" in admin) return fail(500, "server_error", admin.error);
    const house = await loadHouseByNumber(auth, scope, Number(loaded.row.house_number));
    if (!house.ok && (house.status !== 404 || scope.mode !== "all")) return house;
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
    await releaseReview(auth, itemId);
    return fail(created.status, (created.code ?? "server_error") as MissioErrorCode, created.error);
  }
  const person = await requireMissioPerson(auth, created.body.person.contactId);
  if (!person.ok) {
    await releaseReview(auth, itemId);
    return person;
  }
  const admin = adminClient();
  if ("error" in admin) {
    await releaseReview(auth, itemId);
    return fail(500, "server_error", admin.error);
  }
  const stamped = await auth.supabase
    .from("missio_import_review")
    .update({ resolved_contact_id: person.contact.id })
    .eq("id", itemId)
    .eq("org_id", auth.orgId)
    .eq("status", "new")
    .select(REVIEW_COLUMNS)
    .maybeSingle();
  if (stamped.error || !stamped.data) {
    console.error("[missio] import review contact stamp failed", stamped.error?.message ?? "no row");
    await releaseReview(auth, itemId);
    return fail(500, "server_error", "Something went wrong.");
  }
  const attached = await attachKnownMember(auth, admin.client, house.house, person, role);
  if (!attached.ok) {
    await releaseReview(auth, itemId);
    return attached;
  }
  return shapeClaimedReview(auth, admin.client, stamped.data as ReviewRow, house.house, attached.member, "create");
}
