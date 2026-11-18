import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole, type OrgAccess } from "@/lib/missio/access";
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
// Linking a card to an existing contact is allowed only when that contact
// already has a Missio org_people row. A non-Missio FFSA contact returns
// 409 exists_use_search and is not added. Creating a person from the card
// uses the Phase 0 create path, which may insert org_people. The public
// submit's matched_contact_id is left as an internal hint and is not enough
// to pull someone into Missio.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };

const VIEW = "missio_not_in_house";
const VIEW_COLUMNS =
  "source, contact_id, connect_response_id, display_name, phone, email, wants_house_church, followup_stage, submitted_at";
const FOLLOWUP_COLUMNS =
  "id, org_id, contact_id, connect_response_id, stage, assigned_leader_contact_id, effective_stage, created_at";
const CARD_COLUMNS =
  "id, org_id, name, phone, email, visit_type, wants_house_church, wants_prayer, submitted_at, matched_contact_id, campus";
const HISTORY_COLUMNS = "id, followup_id, from_stage, to_stage, changed_by, changed_at, notes, kind";

/**
 * Until product decides, follow-up responses do not return directory phone
 * or email. Contact rows ('c_') return null. Card rows ('r_') return only
 * connect_responses.phone and connect_responses.email — what was typed on
 * the card. Flip this to return directory phone and email on 'c_' rows.
 */
export const FOLLOWUP_LIST_INCLUDES_CONTACT_PII = false;

const EXISTS_USE_SEARCH = {
  error: "This person already exists. Search by their email or phone to add them.",
  code: "exists_use_search" as const,
};

type ViewRow = {
  source: string;
  contact_id: string | null;
  connect_response_id: string | null;
  display_name: string | null;
  phone: string | null;
  email: string | null;
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

function listPii(
  source: FollowupSource,
  view: { phone: string | null; email: string | null },
  card: { phone: string | null; email: string | null } | null
): { phone: string | null; email: string | null } {
  if (source === "connect_response") {
    return { phone: card?.phone ?? null, email: card?.email ?? null };
  }
  if (!FOLLOWUP_LIST_INCLUDES_CONTACT_PII) return { phone: null, email: null };
  return { phone: view.phone, email: view.email };
}

function toPerson(args: {
  source: FollowupSource;
  contactId: string | null;
  connectResponseId: string | null;
  displayName: string;
  viewPhone: string | null;
  viewEmail: string | null;
  card: CardRow | null;
  followup: FollowupRow | null;
  leader: PersonRef | null;
  submittedAt: string | null;
  wantsHouseChurch: boolean | null;
}): FollowupPerson | null {
  const key = keyFor(args.source, args.contactId, args.connectResponseId);
  if (!key) return null;
  const stage = asStage(args.followup?.effective_stage) ?? asStage(args.followup?.stage) ?? "new";
  const pii = listPii(args.source, { phone: args.viewPhone, email: args.viewEmail }, args.card);
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
  if (error) return serverError("follow-up person", error.code ?? error.message);
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
    if (error) return serverError(`${table} read`, error.code ?? error.message);
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
      return serverError("follow-up names", contacts.error?.code ?? people.error?.code ?? "query");
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
    viewEmail: view.email,
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
  if (listed.error) return serverError("follow-up list", listed.error.code ?? listed.error.message);
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

async function insertFollowup(auth: OrgAccess, view: ViewRow, stage: FollowupStage): Promise<{ row: FollowupRow } | Fail> {
  if (!view.contact_id && !view.connect_response_id) return serverError("follow-up subject");
  const inserted = await auth.supabase
    .from("missio_followups")
    .insert({
      org_id: auth.orgId,
      contact_id: view.contact_id,
      connect_response_id: view.connect_response_id,
      stage,
    })
    .select("id, org_id, contact_id, connect_response_id, stage, assigned_leader_contact_id, created_at")
    .maybeSingle();
  if (inserted.error?.code === "23505") {
    const again = await findFollowup(auth, view);
    if (isFail(again)) return again;
    if (again.row) return { row: again.row };
  }
  if (inserted.error || !inserted.data?.id) return serverError("follow-up insert", inserted.error?.code ?? "insert");
  const row = inserted.data as FollowupRow;
  return { row: { ...row, effective_stage: row.stage } };
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
  if (error) return serverError("connect card", error.code ?? error.message);
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
    })
    .select(HISTORY_COLUMNS)
    .maybeSingle();
  if (inserted.error || !inserted.data?.id) return serverError("follow-up note", inserted.error?.code ?? "insert");
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
  } else if (row.stage !== stage) {
    const updated = await auth.supabase
      .from("missio_followups")
      .update({ stage })
      .eq("id", row.id)
      .eq("org_id", auth.orgId)
      .select("id, org_id, contact_id, connect_response_id, stage, assigned_leader_contact_id, created_at")
      .maybeSingle();
    if (updated.error || !updated.data?.id) return serverError("follow-up stage", updated.error?.code ?? "update");
    row = { ...(updated.data as FollowupRow), effective_stage: stage };
  } else {
    row = { ...row, effective_stage: row.effective_stage ?? row.stage };
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
  if (houses.error) return serverError("follow-up leaders", houses.error.code ?? houses.error.message);
  const houseIds = ((houses.data ?? []) as Array<{ id?: string }>).map((row) => row.id).filter((id): id is string => Boolean(id));

  const memberContactIds: string[] = [];
  if (houseIds.length > 0) {
    const members = await auth.supabase
      .from("house_church_members")
      .select("contact_id, role, started_at, ended_at")
      .in("house_church_id", houseIds)
      .in("role", ["leader", "co_leader"]);
    if (members.error) return serverError("follow-up leaders", members.error.code ?? members.error.message);
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
  if (pastors.error) return serverError("follow-up pastors", pastors.error.code ?? pastors.error.message);
  const pastorUserIds = ((pastors.data ?? []) as Array<{ user_id?: string }>)
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  const pastorContactIds: string[] = [];
  if (pastorUserIds.length > 0) {
    const users = await admin.client.from("users").select("id, contact_id").in("id", pastorUserIds);
    if (users.error) return serverError("follow-up pastors", users.error.code ?? users.error.message);
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
  if (people.error) return serverError("follow-up leaders", people.error.code ?? people.error.message);
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
    const leaders = await listLeaders(auth);
    if (!leaders.ok) return leaders;
    if (!leaders.leaders.some((leader) => leader.contactId.toLowerCase() === leaderId)) {
      return fail(400, "invalid_input", "Choose a leader from the list.");
    }
  }

  const view = await loadViewRow(auth, key);
  if (isFail(view)) return view;
  const existing = await findFollowup(auth, view.row);
  if (isFail(existing)) return existing;
  let row = existing.row;
  if (!row) {
    const created = await insertFollowup(auth, view.row, "new");
    if (isFail(created)) return created;
    row = created.row;
  }
  const updated = await auth.supabase
    .from("missio_followups")
    .update({ assigned_leader_contact_id: leaderId })
    .eq("id", row.id)
    .eq("org_id", auth.orgId)
    .select("id, org_id, contact_id, connect_response_id, stage, assigned_leader_contact_id, created_at")
    .maybeSingle();
  if (updated.error || !updated.data?.id) return serverError("follow-up leader", updated.error?.code ?? "update");
  row = { ...(updated.data as FollowupRow), effective_stage: (updated.data as FollowupRow).stage };

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
    if (matched.error) return serverError("follow-up timeline", matched.error.code ?? matched.error.message);
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
    if (rows.error) return serverError("follow-up timeline", rows.error.code ?? rows.error.message);
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
  }
  const noted = await insertNote(auth, row.id, text);
  if (isFail(noted)) return noted;
  await audit(auth.user.id, "missio.followup_note", row.id, { length: text.length });
  return { ok: true, entry: noted.entry };
}

async function missioContact(auth: OrgAccess, contactId: string): Promise<{ inMissio: boolean } | Fail> {
  const { data, error } = await auth.supabase
    .from("org_people")
    .select("id")
    .eq("org_id", auth.orgId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) return serverError("follow-up contact", error.code ?? error.message);
  return { inMissio: Boolean(data?.id) };
}

async function identifierContactIds(admin: Client, card: CardRow): Promise<{ ids: string[] } | Fail> {
  const ids = new Set<string>();
  if (card.phone) {
    const phones = await admin.from("contact_phones").select("contact_id").eq("phone_normalized", card.phone).limit(5);
    if (phones.error) return serverError("follow-up contact", phones.error.code ?? phones.error.message);
    for (const row of (phones.data ?? []) as Array<{ contact_id?: string }>) {
      if (row.contact_id) ids.add(row.contact_id);
    }
  }
  if (card.email) {
    const normalized = card.email.trim().toLowerCase();
    const emails = await admin.from("contact_emails").select("contact_id").eq("email_normalized", normalized).limit(5);
    if (emails.error) return serverError("follow-up contact", emails.error.code ?? emails.error.message);
    for (const row of (emails.data ?? []) as Array<{ contact_id?: string }>) {
      if (row.contact_id) ids.add(row.contact_id);
    }
  }
  return { ids: [...ids] };
}

async function linkCard(
  auth: OrgAccess,
  card: CardRow,
  contactId: string,
  view: ViewRow,
  outcome: "linked" | "created" = "linked"
): Promise<{ ok: true; body: { person: FollowupPerson } } | Fail> {
  const updated = await auth.supabase
    .from("connect_responses")
    .update({
      matched_contact_id: contactId,
      matched_by: auth.user.id,
      matched_at: new Date().toISOString(),
    })
    .eq("id", card.id)
    .eq("org_id", auth.orgId)
    .select("id")
    .maybeSingle();
  if (updated.error || !updated.data?.id) return serverError("follow-up contact link", updated.error?.code ?? "update");

  const existing = await findFollowup(auth, { ...view, contact_id: contactId, connect_response_id: card.id });
  const followup = isFail(existing) ? null : existing.row;
  if (followup && !followup.contact_id) {
    await auth.supabase
      .from("missio_followups")
      .update({ contact_id: contactId })
      .eq("id", followup.id)
      .eq("org_id", auth.orgId);
  }

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
    viewEmail: null,
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
    const member = await missioContact(auth, card.matched_contact_id);
    if (isFail(member)) return member;
    if (!member.inMissio) {
      await audit(auth.user.id, "missio.followup_contact", card.id, { outcome: "exists_use_search" });
      return { ok: false, status: 409, ...EXISTS_USE_SEARCH };
    }
    return linkCard(auth, card, card.matched_contact_id, view.row);
  }

  const admin = adminClient();
  if ("error" in admin) return serverError("follow-up contact");
  const found = await identifierContactIds(admin.client, card);
  if (isFail(found)) return found;
  if (found.ids.length > 0) {
    const members = await auth.supabase
      .from("org_people")
      .select("contact_id")
      .eq("org_id", auth.orgId)
      .in("contact_id", found.ids);
    if (members.error) return serverError("follow-up contact", members.error.code ?? members.error.message);
    const inOrg = new Set(
      ((members.data ?? []) as Array<{ contact_id?: string }>).map((row) => row.contact_id).filter((id): id is string => Boolean(id))
    );
    const outside = found.ids.filter((id) => !inOrg.has(id));
    if (outside.length > 0 || inOrg.size !== 1) {
      await audit(auth.user.id, "missio.followup_contact", card.id, { outcome: "exists_use_search" });
      return { ok: false, status: 409, ...EXISTS_USE_SEARCH };
    }
    const [contactId] = [...inOrg];
    return linkCard(auth, card, contactId, view.row);
  }

  const created = await createPerson(auth, {
    name: card.name,
    phone: card.phone ?? undefined,
    email: card.email ?? undefined,
    campus: asCampus(card.campus),
    status: "visitor",
  });
  if (!created.ok) {
    if (created.code === "exists_use_search" || created.code === "already_in_org") {
      await audit(auth.user.id, "missio.followup_contact", card.id, { outcome: created.code });
      return fail(created.status, created.code, created.error);
    }
    return fail(created.status === 400 ? 400 : 500, created.status === 400 ? "invalid_input" : "server_error", "Check the fields and try again.");
  }

  const contactId = created.body.person.contactId;
  const linked = await linkCard(auth, card, contactId, view.row, "created");
  if (!linked.ok) return linked;
  return linked;
}
