import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole, type OrgAccess } from "@/lib/missio/access";
import { mapMissioDbError } from "@/lib/missio/db-errors";
import { membershipIsCurrent } from "@/lib/missio/house-church-import";
import { isUuid, resolveHouseScope, toPersonRef } from "@/lib/missio/house-churches";
import { createPerson } from "@/lib/missio/people";
import type {
  ConnectVisitType,
  FollowupListResponse,
  FollowupPerson,
  FollowupSource,
  FollowupStage,
  FollowupTimelineEntry,
  MissioCampus,
  MissioErrorCode,
  PersonRef,
} from "@/lib/missio/types";

// Pastor follow-up. has_org_role('missio', ['pastor']) only.
// is_admin(), has_role(), and has_any_role() are not a pass.
// resolveHouseScope is the same gate the house routes use: pastors see the
// whole funnel in v1. The list is not filtered by house.
//
// Stage changes go through the pastor's session client so
// record_missio_followup_stage() stores changed_by = auth.uid().
// This module never inserts kind = 'stage_change'. Notes omit changed_by
// and let the column default fill auth.uid().
//
// Linking a card or assigning a leader checks Missio org_people on the
// session client before any service-role read. Unknown and non-Missio
// contacts get the same response, with no name lookup. A leader must also
// be a current house leader or co-leader, or a Missio pastor.
// State changes claim the follow-up or card with a conditional update
// first. A lost claim is 409 and does not continue into side effects.
// org_people is inserted before matched_contact_id is written.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };

const VIEW = "missio_not_in_house";
const VIEW_COLUMNS =
  "source, contact_id, connect_response_id, display_name, phone, phone_e164, wants_house_church, followup_stage, submitted_at";
/** Columns authenticated pastors may UPDATE. Service-role writes from these routes stay inside this list. */
const FOLLOWUP_UPDATE_COLUMNS = new Set(["stage", "assigned_leader_contact_id", "assigned_user_id"]);

const FOLLOWUP_COLUMNS =
  "id, org_id, contact_id, connect_response_id, stage, assigned_leader_contact_id, effective_stage, created_at, updated_at";
const FOLLOWUP_WRITE_COLUMNS =
  "id, org_id, contact_id, connect_response_id, stage, assigned_leader_contact_id, created_at, updated_at";
const CARD_COLUMNS =
  "id, org_id, name, phone, email, visit_type, wants_house_church, wants_prayer, submitted_at, matched_contact_id, matched_by, campus";
const HISTORY_COLUMNS = "id, followup_id, from_stage, to_stage, changed_by, changed_at, notes, kind";

/**
 * Until Jack decides, the follow-up list shows the card phone only.
 * false: r_ rows return the card's raw phone. c_ rows return null phone.
 *        email is null on every row. The view has no email column.
 * true: reserved for a later decision. This branch is the one place to flip.
 */
export const FOLLOWUP_LIST_INCLUDES_CONTACT_PII = false;

const EXISTS_USE_SEARCH = {
  error: "This person already exists. Search by their email or phone to add them.",
  code: "exists_use_search" as const,
};

const NOT_MISSIO = fail(400, "not_missio_person", "This person is not in Missio.");
const CONFLICT = fail(409, "conflict", "Someone else updated this. Refresh and try again.");

type ViewRow = {
  source: string;
  contact_id: string | null;
  connect_response_id: string | null;
  display_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  wants_house_church: boolean | null;
  followup_stage: string | null;
  submitted_at: string | null;
};

type FollowupRow = {
  id: string;
  org_id: string;
  contact_id: string | null;
  connect_response_id: string | null;
  stage: string;
  assigned_leader_contact_id: string | null;
  effective_stage?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CardRow = {
  id: string;
  org_id?: string;
  name: string;
  phone: string | null;
  email: string | null;
  visit_type: string | null;
  wants_house_church: boolean | null;
  wants_prayer: boolean | null;
  submitted_at: string | null;
  matched_contact_id: string | null;
  matched_by?: string | null;
  campus: string | null;
};

type HistoryRow = {
  id: string;
  followup_id: string;
  from_stage: string | null;
  to_stage: string | null;
  changed_by: string | null;
  changed_at: string;
  notes: string | null;
  kind: string;
};

type ContactNameRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
};

type ParsedKey =
  | { ok: true; kind: "c"; contactId: string }
  | { ok: true; kind: "r"; connectResponseId: string }
  | { ok: false };

function fail(status: number, code: MissioErrorCode, error: string): Fail {
  return { ok: false, status, code, error };
}

function isFail(value: object): value is Fail {
  return "status" in value && (value as { ok?: boolean }).ok === false;
}

function serverError(scope: string, detail?: string): Fail {
  console.error(`[missio] ${scope}`, detail ?? "failed");
  return fail(500, "server_error", "Something went wrong.");
}

/** SQLSTATE plus the exception text. The response is only the mapped code and fixed message. */
function fromDb(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
  scope: string
): Fail {
  const mapped = mapMissioDbError(error ?? {});
  console.error(`[missio] ${scope} failed`, error?.code ?? "failed");
  return fail(mapped.status, mapped.code, mapped.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function asStage(value: string | null | undefined): FollowupStage | null {
  if (value === "new" || value === "contacted" || value === "visited_house" || value === "joined") return value;
  return null;
}

function asVisit(value: string | null | undefined): ConnectVisitType | null {
  if (value === "first_time" || value === "been_a_while" || value === "regular") return value;
  return null;
}

function asCampus(value: string | null | undefined): MissioCampus {
  return value === "jhb" ? "jhb" : "potch";
}

function adminClient(): { client: Client } | { error: string } {
  try {
    return { client: createAdminClient() };
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return { error: "Something went wrong." };
  }
}

export function parseFollowupKey(raw: string): ParsedKey {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false };
  }
  const match = /^(c|r)_([0-9a-f-]{36})$/i.exec(decoded.trim());
  if (!match) return { ok: false };
  const id = match[2].toLowerCase();
  if (!isUuid(id)) return { ok: false };
  if (match[1].toLowerCase() === "c") return { ok: true, kind: "c", contactId: id };
  return { ok: true, kind: "r", connectResponseId: id };
}

export async function pastorFollowupAccess(): Promise<{ auth: OrgAccess } | { response: NextResponse }> {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return { response: auth.response };
  // Pastors only. A later house-scoped grant returns null from resolveHouseScope
  // until that scope is defined. v1 does not filter the funnel by house.
  if (!resolveHouseScope(auth)) {
    return { response: NextResponse.json({ error: "Not authorized", code: "forbidden" }, { status: 403 }) };
  }
  return { auth };
}

function keyFor(source: FollowupSource, contactId: string | null, connectResponseId: string | null): string | null {
  if (source === "contact" && contactId) return `c_${contactId}`;
  if (source === "connect_response" && connectResponseId) return `r_${connectResponseId}`;
  return null;
}

function listPii(source: FollowupSource, cardPhone: string | null): { phone: string | null; email: string | null } {
  const phone = source === "connect_response" ? cardPhone : null;
  if (!FOLLOWUP_LIST_INCLUDES_CONTACT_PII) return { phone, email: null };
  return { phone, email: null };
}

function toPerson(args: {
  source: FollowupSource;
  contactId: string | null;
  connectResponseId: string | null;
  displayName: string;
  viewPhone: string | null;
  card: CardRow | null;
  followup: FollowupRow | null;
  leader: PersonRef | null;
  submittedAt: string | null;
  wantsHouseChurch: boolean | null;
}): FollowupPerson | null {
  const key = keyFor(args.source, args.contactId, args.connectResponseId);
  if (!key) return null;
  const stage = asStage(args.followup?.effective_stage) ?? asStage(args.followup?.stage) ?? "new";
  const pii = listPii(args.source, args.viewPhone);
  return {
    key,
    source: args.source,
    contactId: args.contactId,
    connectResponseId: args.connectResponseId,
    followupId: args.followup?.id ?? null,
    displayName: args.displayName,
    phone: pii.phone,
    email: pii.email,
    visitType: asVisit(args.card?.visit_type),
    wantsHouseChurch: args.wantsHouseChurch,
    wantsPrayer: args.card?.wants_prayer ?? null,
    stage,
    assignedLeader: args.leader,
    submittedAt: args.submittedAt,
  };
}

async function loadViewRow(auth: OrgAccess, key: Exclude<ParsedKey, { ok: false }>): Promise<{ row: ViewRow } | Fail> {
  let query = auth.supabase.from(VIEW).select(VIEW_COLUMNS);
  if (key.kind === "c") query = query.eq("source", "contact").eq("contact_id", key.contactId);
  else query = query.eq("source", "connect_response").eq("connect_response_id", key.connectResponseId);
  const { data, error } = await query.limit(1);
  if (error) return fromDb(error, "follow-up person");
  const row = ((data ?? []) as ViewRow[])[0];
  if (!row) return fail(404, "not_found", "Person not found.");
  return { row };
}

async function rowsByIds(
  auth: OrgAccess,
  table: string,
  columns: string,
  column: string,
  ids: string[]
): Promise<{ rows: Record<string, unknown>[] } | Fail> {
  const rows: Record<string, unknown>[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const slice = unique.slice(i, i + 100);
    const { data, error } = await auth.supabase.from(table).select(columns).eq("org_id", auth.orgId).in(column, slice);
    if (error) return fromDb(error, `${table} read`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return { rows };
}

async function loadFollowups(auth: OrgAccess, viewRows: ViewRow[]): Promise<{ rows: FollowupRow[] } | Fail> {
  const contactIds = viewRows.map((row) => row.contact_id).filter((id): id is string => Boolean(id));
  const responseIds = viewRows.map((row) => row.connect_response_id).filter((id): id is string => Boolean(id));
  const [byContact, byResponse] = await Promise.all([
    contactIds.length
      ? rowsByIds(auth, "missio_followup_effective", FOLLOWUP_COLUMNS, "contact_id", contactIds)
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    responseIds.length
      ? rowsByIds(auth, "missio_followup_effective", FOLLOWUP_COLUMNS, "connect_response_id", responseIds)
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  if (isFail(byContact)) return byContact;
  if (isFail(byResponse)) return byResponse;
  const merged = new Map<string, FollowupRow>();
  for (const row of [...byContact.rows, ...byResponse.rows] as FollowupRow[]) {
    if (row.id) merged.set(row.id, row);
  }
  return { rows: [...merged.values()] };
}

function followupFor(view: ViewRow, followups: FollowupRow[]): FollowupRow | null {
  const hits = followups.filter(
    (row) =>
      (view.contact_id != null && row.contact_id === view.contact_id) ||
      (view.connect_response_id != null && row.connect_response_id === view.connect_response_id)
  );
  if (hits.length === 0) return null;
  const contactHit = view.contact_id ? hits.find((row) => row.contact_id === view.contact_id) : undefined;
  if (view.source === "contact" && contactHit) return contactHit;
  const responseHit = view.connect_response_id
    ? hits.find((row) => row.connect_response_id === view.connect_response_id)
    : undefined;
  return responseHit ?? contactHit ?? hits[0];
}

async function loadCards(auth: OrgAccess, ids: string[]): Promise<{ map: Map<string, CardRow> } | Fail> {
  const map = new Map<string, CardRow>();
  if (ids.length === 0) return { map };
  const loaded = await rowsByIds(auth, "connect_responses", CARD_COLUMNS, "id", ids);
  if (isFail(loaded)) return loaded;
  for (const row of loaded.rows as CardRow[]) map.set(row.id, row);
  return { map };
}

async function loadPersonRefs(auth: OrgAccess, contactIds: string[]): Promise<{ map: Map<string, PersonRef> } | Fail> {
  const ids = [...new Set(contactIds)];
  const map = new Map<string, PersonRef>();
  if (ids.length === 0) return { map };
  const admin = adminClient();
  if ("error" in admin) return serverError("follow-up names");
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const [contacts, people] = await Promise.all([
      admin.client.from("contacts").select("id, first_name, last_name, preferred_name").in("id", slice),
      auth.supabase.from("org_people").select("id, contact_id").eq("org_id", auth.orgId).in("contact_id", slice),
    ]);
    if (contacts.error || people.error) {
      return fromDb(contacts.error ?? people.error, "follow-up names");
    }
    const orgByContact = new Map<string, string>();
    for (const row of (people.data ?? []) as Array<{ id?: string; contact_id?: string }>) {
      if (row.contact_id && row.id && !orgByContact.has(row.contact_id)) orgByContact.set(row.contact_id, row.id);
    }
    for (const contact of (contacts.data ?? []) as ContactNameRow[]) {
      map.set(contact.id, toPersonRef(contact, orgByContact.get(contact.id)));
    }
  }
  return { map };
}

function leaderRef(map: Map<string, PersonRef>, contactId: string | null): PersonRef | null {
  if (!contactId) return null;
  return map.get(contactId) ?? { contactId, displayName: "", firstName: null, lastName: null };
}

function personFrom(view: ViewRow, card: CardRow | null, followup: FollowupRow | null, leaders: Map<string, PersonRef>): FollowupPerson | null {
  const source: FollowupSource | null =
    view.source === "contact" || view.source === "connect_response" ? view.source : null;
  if (!source) return null;
  return toPerson({
    source,
    contactId: view.contact_id,
    connectResponseId: view.connect_response_id,
    displayName: blank(view.display_name) ?? blank(card?.name) ?? "",
    viewPhone: view.phone,
    card,
    followup,
    leader: leaderRef(leaders, followup?.assigned_leader_contact_id ?? null),
    submittedAt: view.submitted_at ?? card?.submitted_at ?? null,
    wantsHouseChurch: view.wants_house_church,
  });
}

export async function listFollowups(
  auth: OrgAccess,
  query: { stage: FollowupStage | null; leader: string | null }
): Promise<{ ok: true; body: FollowupListResponse } | Fail> {
  const listed = await auth.supabase.from(VIEW).select(VIEW_COLUMNS);
  if (listed.error) return fromDb(listed.error, "follow-up list");
  const views = (listed.data ?? []) as ViewRow[];
  const followups = await loadFollowups(auth, views);
  if (isFail(followups)) return followups;
  const cardIds = views.map((row) => row.connect_response_id).filter((id): id is string => Boolean(id));
  const cards = await loadCards(auth, cardIds);
  if (isFail(cards)) return cards;
  const leaderIds = followups.rows
    .map((row) => row.assigned_leader_contact_id)
    .filter((id): id is string => Boolean(id));
  const leaders = await loadPersonRefs(auth, leaderIds);
  if (isFail(leaders)) return leaders;

  let people = views
    .map((view) => personFrom(view, view.connect_response_id ? cards.map.get(view.connect_response_id) ?? null : null, followupFor(view, followups.rows), leaders.map))
    .filter((person): person is FollowupPerson => Boolean(person));

  if (query.stage) people = people.filter((person) => person.stage === query.stage);
  if (query.leader === "unassigned") people = people.filter((person) => !person.assignedLeader);
  else if (query.leader) people = people.filter((person) => person.assignedLeader?.contactId === query.leader);

  people.sort(
    (a, b) =>
      (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "") ||
      a.displayName.localeCompare(b.displayName, "en") ||
      a.key.localeCompare(b.key)
  );
  return { ok: true, body: { people, canWrite: true } };
}

export function readFollowupQuery(
  url: URL
): { ok: true; stage: FollowupStage | null; leader: string | null } | Fail {
  const stageRaw = url.searchParams.get("stage");
  const leaderRaw = url.searchParams.get("leader");
  let stage: FollowupStage | null = null;
  if (stageRaw) {
    const parsed = asStage(stageRaw);
    if (!parsed) return fail(400, "invalid_input", "Check the fields and try again.");
    stage = parsed;
  }
  let leader: string | null = null;
  if (leaderRaw) {
    if (leaderRaw === "unassigned") leader = "unassigned";
    else if (isUuid(leaderRaw)) leader = leaderRaw.toLowerCase();
    else return fail(400, "invalid_input", "Check the fields and try again.");
  }
  return { ok: true, stage, leader };
}

async function findFollowup(auth: OrgAccess, view: ViewRow): Promise<{ row: FollowupRow | null } | Fail> {
  const loaded = await loadFollowups(auth, [view]);
  if (isFail(loaded)) return loaded;
  const row = followupFor(view, loaded.rows);
  if (!row) return { row: null };
  return {
    row: {
      ...row,
      stage: row.stage,
      effective_stage: row.effective_stage ?? row.stage,
    },
  };
}

async function orgContactOrNull(auth: OrgAccess, contactId: string | null): Promise<{ id: string | null } | Fail> {
  if (!contactId) return { id: null };
  const person = await missioOrgPersonId(auth, contactId);
  if (!isFail(person)) return { id: contactId };
  if (person.code === "not_missio_person") return { id: null };
  return person;
}

async function insertFollowup(
  auth: OrgAccess,
  view: ViewRow,
  stage: FollowupStage,
  leaderContactId?: string | null
): Promise<{ row: FollowupRow } | Fail> {
  const contact = await orgContactOrNull(auth, view.contact_id);
  if (isFail(contact)) return contact;
  const leader = leaderContactId === undefined ? undefined : await orgContactOrNull(auth, leaderContactId);
  if (leader && isFail(leader)) return leader;
  if (!contact.id && !view.connect_response_id) return serverError("follow-up subject");
  const payload: Record<string, unknown> = {
    org_id: auth.orgId,
    contact_id: contact.id,
    connect_response_id: view.connect_response_id,
    stage,
  };
  if (leader) payload.assigned_leader_contact_id = leader.id;
  const inserted = await auth.supabase.from("missio_followups").insert(payload).select(FOLLOWUP_WRITE_COLUMNS).maybeSingle();
  // Another pastor inserted the same person. Do not adopt or overwrite their row.
  if (inserted.error) return fromDb(inserted.error, "follow-up insert");
  if (!inserted.data?.id) return serverError("follow-up insert");
  const row = inserted.data as FollowupRow;
  return { row: { ...row, effective_stage: row.stage } };
}

/**
 * Compare-and-set. The where clause is the row we just read. Zero rows
 * means another pastor changed it; callers must not continue into side effects.
 */
async function claimFollowup(
  auth: OrgAccess,
  row: FollowupRow,
  patch: Record<string, unknown>
): Promise<{ row: FollowupRow } | Fail> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (FOLLOWUP_UPDATE_COLUMNS.has(key)) set[key] = value;
  }
  let query = auth.supabase
    .from("missio_followups")
    .update(set)
    .eq("id", row.id)
    .eq("org_id", auth.orgId)
    .eq("stage", row.stage);
  if (row.updated_at) query = query.eq("updated_at", row.updated_at);
  const updated = await query.select(FOLLOWUP_WRITE_COLUMNS).maybeSingle();
  if (updated.error) return fromDb(updated.error, "follow-up claim");
  if (!updated.data?.id) return CONFLICT;
  const next = updated.data as FollowupRow;
  const stage = typeof patch.stage === "string" ? patch.stage : next.stage;
  return { row: { ...next, effective_stage: stage } };
}

async function audit(
  userId: string,
  action: string,
  resourceId: string,
  changes: Record<string, unknown>
) {
  const admin = adminClient();
  if ("error" in admin) return;
  const { error } = await admin.client.from("audit_logs").insert({
    user_id: userId,
    action,
    resource_type: "missio_followup",
    resource_id: resourceId,
    changes,
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[missio] follow-up audit failed", error.code ?? "insert");
}

async function cardFor(auth: OrgAccess, id: string | null): Promise<{ card: CardRow | null } | Fail> {
  if (!id) return { card: null };
  const { data, error } = await auth.supabase
    .from("connect_responses")
    .select(CARD_COLUMNS)
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();
  if (error) return fromDb(error, "connect card");
  return { card: (data as CardRow | null) ?? null };
}

async function personForView(auth: OrgAccess, view: ViewRow, followup: FollowupRow | null): Promise<{ person: FollowupPerson } | Fail> {
  const card = await cardFor(auth, view.connect_response_id);
  if (isFail(card)) return card;
  const leaders = await loadPersonRefs(auth, followup?.assigned_leader_contact_id ? [followup.assigned_leader_contact_id] : []);
  if (isFail(leaders)) return leaders;
  const person = personFrom(view, card.card, followup, leaders.map);
  if (!person) return fail(404, "not_found", "Person not found.");
  return { person };
}

async function insertNote(auth: OrgAccess, followupId: string, notes: string): Promise<{ entry: FollowupTimelineEntry } | Fail> {
  // kind is fixed. changed_by is omitted so the column default (auth.uid()) applies.
  const inserted = await auth.supabase
    .from("missio_followup_stage_history")
    .insert({
      followup_id: followupId,
      kind: "note",
      notes,
      changed_by: auth.user.id,
    })
    .select(HISTORY_COLUMNS)
    .maybeSingle();
  if (inserted.error) return fromDb(inserted.error, "follow-up note");
  if (!inserted.data?.id) return serverError("follow-up note");
  const row = inserted.data as HistoryRow;
  const names = await displayNames(auth, row.changed_by ? [row.changed_by] : []);
  const entry = historyEntry(row, names);
  if (!entry) return serverError("follow-up note");
  return { entry };
}

export async function setFollowupStage(
  auth: OrgAccess,
  keyRaw: string,
  body: unknown
): Promise<{ ok: true; body: { person: FollowupPerson; entries?: FollowupTimelineEntry[] } } | Fail> {
  const key = parseFollowupKey(keyRaw);
  if (!key.ok) return fail(400, "invalid_input", "Check the fields and try again.");
  if (!isRecord(body)) return fail(400, "invalid_input", "Check the fields and try again.");
  const extra = Object.keys(body).filter((name) => name !== "stage" && name !== "note");
  if (extra.length > 0 || typeof body.stage !== "string") return fail(400, "invalid_input", "Check the fields and try again.");
  const stage = asStage(body.stage);
  if (!stage) return fail(400, "invalid_input", "Check the fields and try again.");
  let note: string | null = null;
  if (body.note != null && body.note !== "") {
    if (typeof body.note !== "string") return fail(400, "invalid_input", "Check the fields and try again.");
    note = body.note.trim();
    if (note.length < 1 || note.length > 2000) return fail(400, "invalid_input", "Check the fields and try again.");
  }

  const view = await loadViewRow(auth, key);
  if (isFail(view)) return view;
  const existing = await findFollowup(auth, view.row);
  if (isFail(existing)) return existing;

  let row = existing.row;
  const fromStage = asStage(row?.stage);
  if (!row) {
    const created = await insertFollowup(auth, view.row, stage);
    if (isFail(created)) return created;
    row = created.row;
  } else {
    const claimed = await claimFollowup(auth, row, { stage });
    if (isFail(claimed)) return claimed;
    row = claimed.row;
  }

  let entry: FollowupTimelineEntry | null = null;
  if (note) {
    const noted = await insertNote(auth, row.id, note);
    if (isFail(noted)) return noted;
    entry = noted.entry;
  }

  await audit(auth.user.id, "missio.followup_stage", row.id, {
    key: keyFor(view.row.source === "contact" ? "contact" : "connect_response", view.row.contact_id, view.row.connect_response_id),
    fromStage,
    toStage: stage,
    noted: Boolean(note),
  });

  const person = await personForView(auth, view.row, row);
  if (isFail(person)) return person;
  return entry ? { ok: true, body: { person: person.person, entries: [entry] } } : { ok: true, body: { person: person.person } };
}

export async function listLeaders(auth: OrgAccess): Promise<{ ok: true; leaders: PersonRef[] } | Fail> {
  const houses = await auth.supabase.from("house_churches").select("id").eq("org_id", auth.orgId);
  if (houses.error) return fromDb(houses.error, "follow-up leaders");
  const houseIds = ((houses.data ?? []) as Array<{ id?: string }>).map((row) => row.id).filter((id): id is string => Boolean(id));

  const memberContactIds: string[] = [];
  if (houseIds.length > 0) {
    const members = await auth.supabase
      .from("house_church_members")
      .select("contact_id, role, started_at, ended_at")
      .in("house_church_id", houseIds)
      .in("role", ["leader", "co_leader"]);
    if (members.error) return fromDb(members.error, "follow-up leaders");
    for (const row of (members.data ?? []) as Array<{ contact_id?: string; started_at?: string | null; ended_at?: string | null }>) {
      if (!row.contact_id) continue;
      if (!membershipIsCurrent({ startedAt: row.started_at, endedAt: row.ended_at })) continue;
      memberContactIds.push(row.contact_id);
    }
  }

  const admin = adminClient();
  if ("error" in admin) return serverError("follow-up leaders");
  const pastors = await admin.client
    .from("org_staff_roles")
    .select("user_id")
    .eq("org_id", auth.orgId)
    .eq("role", "pastor");
  if (pastors.error) return fromDb(pastors.error, "follow-up pastors");
  const pastorUserIds = ((pastors.data ?? []) as Array<{ user_id?: string }>)
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  const pastorContactIds: string[] = [];
  if (pastorUserIds.length > 0) {
    const users = await admin.client.from("users").select("id, contact_id").in("id", pastorUserIds);
    if (users.error) return fromDb(users.error, "follow-up pastors");
    for (const row of (users.data ?? []) as Array<{ contact_id?: string | null }>) {
      if (row.contact_id) pastorContactIds.push(row.contact_id);
    }
  }

  const candidateIds = [...new Set([...memberContactIds, ...pastorContactIds])];
  if (candidateIds.length === 0) return { ok: true, leaders: [] };
  const people = await auth.supabase
    .from("org_people")
    .select("contact_id")
    .eq("org_id", auth.orgId)
    .in("contact_id", candidateIds);
  if (people.error) return fromDb(people.error, "follow-up leaders");
  const missioIds = ((people.data ?? []) as Array<{ contact_id?: string }>)
    .map((row) => row.contact_id)
    .filter((id): id is string => Boolean(id));
  const refs = await loadPersonRefs(auth, missioIds);
  if (isFail(refs)) return refs;
  const leaders = [...refs.map.values()].sort(
    (a, b) => a.displayName.localeCompare(b.displayName, "en") || a.contactId.localeCompare(b.contactId)
  );
  return { ok: true, leaders };
}

export async function setFollowupLeader(
  auth: OrgAccess,
  keyRaw: string,
  body: unknown
): Promise<{ ok: true; body: { person: FollowupPerson } } | Fail> {
  const key = parseFollowupKey(keyRaw);
  if (!key.ok) return fail(400, "invalid_input", "Check the fields and try again.");
  if (!isRecord(body) || !("leaderContactId" in body) || Object.keys(body).length !== 1) {
    return fail(400, "invalid_input", "Check the fields and try again.");
  }
  const leaderContactId = body.leaderContactId;
  if (leaderContactId !== null && (typeof leaderContactId !== "string" || !isUuid(leaderContactId))) {
    return fail(400, "invalid_input", "Check the fields and try again.");
  }
  const leaderId = typeof leaderContactId === "string" ? leaderContactId.toLowerCase() : null;
  if (leaderId) {
    const allowed = await requireAssignableLeader(auth, leaderId);
    if (isFail(allowed)) return allowed;
  }

  const view = await loadViewRow(auth, key);
  if (isFail(view)) return view;
  const existing = await findFollowup(auth, view.row);
  if (isFail(existing)) return existing;
  let row = existing.row;
  if (!row) {
    const created = await insertFollowup(auth, view.row, "new", leaderId);
    if (isFail(created)) return created;
    row = created.row;
  } else {
    const claimed = await claimFollowup(auth, row, { assigned_leader_contact_id: leaderId });
    if (isFail(claimed)) return claimed;
    row = claimed.row;
  }

  await audit(auth.user.id, "missio.followup_leader", row.id, {
    key: keyFor(view.row.source === "contact" ? "contact" : "connect_response", view.row.contact_id, view.row.connect_response_id),
    leaderContactId: leaderId,
  });
  const person = await personForView(auth, view.row, row);
  if (isFail(person)) return person;
  return { ok: true, body: { person: person.person } };
}

async function displayNames(auth: OrgAccess, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const admin = adminClient();
  if ("error" in admin) return map;
  const { data, error } = await admin.client
    .from("users")
    .select("id, display_name, first_name, last_name, preferred_name")
    .in("id", ids);
  if (error) {
    console.error("[missio] follow-up names", error.code ?? "users");
    return map;
  }
  for (const row of (data ?? []) as Array<{
    id?: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    preferred_name?: string | null;
  }>) {
    if (!row.id) continue;
    const display =
      blank(row.display_name) ??
      [blank(row.preferred_name) ?? blank(row.first_name), blank(row.last_name)].filter(Boolean).join(" ");
    if (display) map.set(row.id, display);
  }
  return map;
}

function historyEntry(row: HistoryRow, names: Map<string, string>): FollowupTimelineEntry | null {
  if (row.kind !== "stage_change" && row.kind !== "note") return null;
  const displayName = row.changed_by ? names.get(row.changed_by) : undefined;
  return {
    id: row.id,
    kind: row.kind,
    fromStage: asStage(row.from_stage),
    toStage: asStage(row.to_stage),
    body: blank(row.notes),
    by: displayName ? { displayName } : null,
    at: row.changed_at,
  };
}

async function submittedEntries(auth: OrgAccess, view: ViewRow): Promise<{ entries: FollowupTimelineEntry[] } | Fail> {
  const ids = view.connect_response_id ? [view.connect_response_id] : [];
  if (view.contact_id) {
    const matched = await auth.supabase
      .from("connect_responses")
      .select("id, submitted_at")
      .eq("org_id", auth.orgId)
      .eq("matched_contact_id", view.contact_id);
    if (matched.error) return fromDb(matched.error, "follow-up timeline");
    for (const row of (matched.data ?? []) as Array<{ id?: string }>) {
      if (row.id) ids.push(row.id);
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { entries: [] };
  const cards = await loadCards(auth, unique);
  if (isFail(cards)) return cards;
  const entries: FollowupTimelineEntry[] = [];
  for (const card of cards.map.values()) {
    if (!card.submitted_at) continue;
    entries.push({
      id: `submitted_${card.id}`,
      kind: "submitted",
      fromStage: null,
      toStage: null,
      body: null,
      by: null,
      at: card.submitted_at,
    });
  }
  return { entries };
}

export async function listTimeline(
  auth: OrgAccess,
  keyRaw: string
): Promise<{ ok: true; entries: FollowupTimelineEntry[] } | Fail> {
  const key = parseFollowupKey(keyRaw);
  if (!key.ok) return fail(400, "invalid_input", "Check the fields and try again.");
  const view = await loadViewRow(auth, key);
  if (isFail(view)) return view;
  const followup = await findFollowup(auth, view.row);
  if (isFail(followup)) return followup;
  const submitted = await submittedEntries(auth, view.row);
  if (isFail(submitted)) return submitted;

  let history: FollowupTimelineEntry[] = [];
  if (followup.row) {
    const rows = await auth.supabase
      .from("missio_followup_stage_history")
      .select(HISTORY_COLUMNS)
      .eq("followup_id", followup.row.id)
      .order("changed_at", { ascending: false });
    if (rows.error) return fromDb(rows.error, "follow-up timeline");
    const historyRows = (rows.data ?? []) as HistoryRow[];
    const names = await displayNames(
      auth,
      historyRows.map((row) => row.changed_by).filter((id): id is string => Boolean(id))
    );
    history = historyRows.map((row) => historyEntry(row, names)).filter((entry): entry is FollowupTimelineEntry => Boolean(entry));
  }

  const entries = [...submitted.entries, ...history].sort(
    (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)
  );
  return { ok: true, entries };
}

export async function addFollowupNote(
  auth: OrgAccess,
  keyRaw: string,
  body: unknown
): Promise<{ ok: true; entry: FollowupTimelineEntry } | Fail> {
  const key = parseFollowupKey(keyRaw);
  if (!key.ok) return fail(400, "invalid_input", "Check the fields and try again.");
  if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.body !== "string") {
    return fail(400, "invalid_input", "Check the fields and try again.");
  }
  const text = body.body.trim();
  if (text.length < 1 || text.length > 2000) return fail(400, "invalid_input", "Check the fields and try again.");

  const view = await loadViewRow(auth, key);
  if (isFail(view)) return view;
  const existing = await findFollowup(auth, view.row);
  if (isFail(existing)) return existing;
  let row = existing.row;
  if (!row) {
    const created = await insertFollowup(auth, view.row, "new");
    if (isFail(created)) return created;
    row = created.row;
  } else {
    const claimed = await claimFollowup(auth, row, { stage: row.stage });
    if (isFail(claimed)) return claimed;
    row = claimed.row;
  }
  const noted = await insertNote(auth, row.id, text);
  if (isFail(noted)) return noted;
  await audit(auth.user.id, "missio.followup_note", row.id, { length: text.length });
  return { ok: true, entry: noted.entry };
}

/**
 * User client only. A missing contact and an FFSA contact with no Missio
 * org_people row are the same result. This does not read contacts.
 */
async function missioOrgPersonId(auth: OrgAccess, contactId: string): Promise<{ id: string } | Fail> {
  const { data, error } = await auth.supabase
    .from("org_people")
    .select("id")
    .eq("org_id", auth.orgId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) return fromDb(error, "follow-up contact");
  if (!data?.id) return NOT_MISSIO;
  return { id: data.id as string };
}

async function isCurrentHouseLeader(auth: OrgAccess, contactId: string): Promise<boolean | Fail> {
  const houses = await auth.supabase.from("house_churches").select("id").eq("org_id", auth.orgId);
  if (houses.error) return fromDb(houses.error, "follow-up leader");
  const houseIds = ((houses.data ?? []) as Array<{ id?: string }>).map((row) => row.id).filter((id): id is string => Boolean(id));
  if (houseIds.length === 0) return false;
  const members = await auth.supabase
    .from("house_church_members")
    .select("role, started_at, ended_at")
    .eq("contact_id", contactId)
    .in("house_church_id", houseIds)
    .in("role", ["leader", "co_leader"]);
  if (members.error) return fromDb(members.error, "follow-up leader");
  for (const row of (members.data ?? []) as Array<{ started_at?: string | null; ended_at?: string | null }>) {
    if (membershipIsCurrent({ startedAt: row.started_at, endedAt: row.ended_at })) return true;
  }
  return false;
}

/**
 * Pastor check runs only after org_people has already matched.
 * Selects ids, not names. The user client is tried first; service role
 * is only the fallback for users RLS, and only past that gate.
 */
async function isMissioPastorContact(auth: OrgAccess, contactId: string): Promise<boolean | Fail> {
  const roles = await auth.supabase
    .from("org_staff_roles")
    .select("user_id")
    .eq("org_id", auth.orgId)
    .eq("role", "pastor");
  if (roles.error) return fromDb(roles.error, "follow-up leader");
  const userIds = ((roles.data ?? []) as Array<{ user_id?: string }>)
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  if (userIds.length === 0) return false;

  const visible = await auth.supabase.from("users").select("id").in("id", userIds).eq("contact_id", contactId);
  if (!visible.error && ((visible.data ?? []) as Array<{ id?: string }>).some((row) => row.id)) return true;

  const admin = adminClient();
  if ("error" in admin) return false;
  const hidden = await admin.client.from("users").select("id").in("id", userIds).eq("contact_id", contactId);
  if (hidden.error) return fromDb(hidden.error, "follow-up leader");
  return ((hidden.data ?? []) as Array<{ id?: string }>).some((row) => row.id);
}

async function requireAssignableLeader(auth: OrgAccess, contactId: string): Promise<{ ok: true } | Fail> {
  const person = await missioOrgPersonId(auth, contactId);
  if (isFail(person)) return person;
  const leading = await isCurrentHouseLeader(auth, contactId);
  if (typeof leading !== "boolean") return leading;
  if (leading) return { ok: true };
  const pastor = await isMissioPastorContact(auth, contactId);
  if (typeof pastor !== "boolean") return pastor;
  if (!pastor) return fail(400, "invalid_input", "Choose a leader from the list.");
  return { ok: true };
}

/**
 * Pastors may UPDATE only matched_contact_id (plus notes and prayer fields).
 * matched_by is not in that grant. The session trigger sets it from auth.uid()
 * when the match changes. A service-role write must not set it here either.
 * Zero rows means another pastor already set the match.
 */
async function setCardMatch(auth: OrgAccess, card: CardRow, contactId: string): Promise<{ ok: true } | Fail> {
  let query = auth.supabase
    .from("connect_responses")
    .update({ matched_contact_id: contactId })
    .eq("id", card.id)
    .eq("org_id", auth.orgId);
  query = card.matched_contact_id ? query.eq("matched_contact_id", card.matched_contact_id) : query.is("matched_contact_id", null);
  const updated = await query.select("id").maybeSingle();
  if (updated.error) return fromDb(updated.error, "follow-up contact link");
  if (!updated.data?.id) return CONFLICT;
  return { ok: true };
}

async function attachFollowupContact(auth: OrgAccess, view: ViewRow, card: CardRow, contactId: string) {
  const existing = await findFollowup(auth, { ...view, contact_id: contactId, connect_response_id: card.id });
  if (isFail(existing)) return existing;
  return { row: existing.row };
}

async function personAfterLink(
  auth: OrgAccess,
  card: CardRow,
  contactId: string,
  followup: FollowupRow | null,
  outcome: "linked" | "created"
): Promise<{ ok: true; body: { person: FollowupPerson } } | Fail> {
  const refs = await loadPersonRefs(auth, [contactId]);
  if (isFail(refs)) return refs;
  const leaders = await loadPersonRefs(auth, followup?.assigned_leader_contact_id ? [followup.assigned_leader_contact_id] : []);
  if (isFail(leaders)) return leaders;
  const person = toPerson({
    source: "contact",
    contactId,
    connectResponseId: card.id,
    displayName: refs.map.get(contactId)?.displayName || card.name,
    viewPhone: null,
    card,
    followup,
    leader: leaderRef(leaders.map, followup?.assigned_leader_contact_id ?? null),
    submittedAt: card.submitted_at,
    wantsHouseChurch: card.wants_house_church,
  });
  if (!person) return serverError("follow-up contact person");
  await audit(auth.user.id, "missio.followup_contact", card.id, { contactId, outcome });
  return { ok: true, body: { person } };
}

export async function linkFollowupContact(
  auth: OrgAccess,
  keyRaw: string,
  body: unknown
): Promise<{ ok: true; body: { person: FollowupPerson } } | Fail> {
  const key = parseFollowupKey(keyRaw);
  if (!key.ok) return fail(400, "invalid_input", "Check the fields and try again.");
  if (key.kind !== "r") return fail(400, "invalid_input", "This person is already a contact.");
  if (isRecord(body) && Object.keys(body).length > 0) return fail(400, "invalid_input", "Check the fields and try again.");

  const view = await loadViewRow(auth, key);
  if (isFail(view)) return view;
  const cardId = view.row.connect_response_id;
  if (!cardId) return fail(404, "not_found", "Person not found.");
  const loaded = await cardFor(auth, cardId);
  if (isFail(loaded)) return loaded;
  const card = loaded.card;
  if (!card) return fail(404, "not_found", "Person not found.");

  if (card.matched_contact_id) {
    // Org wall before any service-role read. Unknown and non-Missio look the same.
    const person = await missioOrgPersonId(auth, card.matched_contact_id);
    if (isFail(person)) {
      if (person.code === "not_missio_person") return NOT_MISSIO;
      return person;
    }
    const claimed = await setCardMatch(auth, card, card.matched_contact_id);
    if (isFail(claimed)) return claimed;
    const followup = await attachFollowupContact(auth, view.row, card, card.matched_contact_id);
    if (isFail(followup)) return followup;
    return personAfterLink(auth, card, card.matched_contact_id, followup.row, "linked");
  }

  const created = await createPerson(auth, {
    name: card.name,
    phone: card.phone ?? undefined,
    email: card.email ?? undefined,
    campus: asCampus(card.campus),
    status: "visitor",
  });
  if (!created.ok) {
    if (created.code === "exists_use_search") return { ok: false, status: 409, ...EXISTS_USE_SEARCH };
    if (created.code === "already_in_org") return fail(409, "already_in_org", "This person is already in Missio.");
    if (created.code === "not_missio_person") return NOT_MISSIO;
    const input = created.status === 400;
    return fail(input ? 400 : 500, input ? "invalid_input" : "server_error", input ? "Check the fields and try again." : "Something went wrong.");
  }

  const contactId = created.body.person.contactId;
  const linked = await setCardMatch(auth, card, contactId);
  if (isFail(linked)) return linked;
  const followup = await attachFollowupContact(auth, view.row, card, contactId);
  if (isFail(followup)) return followup;
  return personAfterLink(auth, card, contactId, followup.row, "created");
}
