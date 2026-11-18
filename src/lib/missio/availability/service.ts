import { createAdminClient } from "@/lib/supabase/admin";
import {
  canEditAvailability,
  formatServiceLabel,
  isTokenExpired,
  johannesburgToday,
  tokenExpiresAt,
} from "@/lib/missio/availability/dates";
import {
  aggregateAvailabilityGrid,
  teamRoster,
  unansweredContacts,
  type AvailabilityChoice,
  type GridCounts,
  type GridResponse,
} from "@/lib/missio/availability/grid";
import { directoryName, publicFirstName } from "@/lib/missio/availability/names";
import { bundleNudges, type NudgePerson } from "@/lib/missio/availability/copy";
import { PUBLIC_NAME_COLUMNS, toPublicAvailability, type PublicAvailabilityView } from "@/lib/missio/availability/public-view";
import type { CreateRequestInput, PublicSaveInput } from "@/lib/missio/availability/schema";
import {
  AVAILABILITY_TOKEN_PATTERN,
  generateAvailabilityToken,
  personalAvailabilityUrl,
  tokenHashRecord,
  verifyAvailabilityToken,
} from "@/lib/missio/availability/token";

// Pastor reads and writes go through the user client, so the Missio
// has_org_role policies apply. Token rows and availability answers are
// service-role only. The raw token is returned to the pastor once and
// is never written. FFSA admin is not a pass: requireOrgRole already
// ran, and these queries do not use a contacts grant.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Fail = { ok: false; status: number; code: string; error: string };
type Ok<T> = { ok: true; body: T };

function fail(status: number, code: string, error: string): Fail {
  return { ok: false, status, code, error };
}

function log(message: string) {
  console.error(`[missio-availability] ${message}`);
}

export type VolunteerPerson = { contactId: string; name: string; firstName: string };

export type VolunteerTeam = {
  id: string;
  name: string;
  leaders: VolunteerPerson[];
  members: VolunteerPerson[];
};

export type VolunteerRequest = {
  id: string;
  startsOn: string;
  endsOn: string;
  serviceDates: string[];
  createdAt: string;
};

export type VolunteersSnapshot = {
  teams: VolunteerTeam[];
  requests: VolunteerRequest[];
  selectedRequestId: string | null;
  grid: {
    teamId: string;
    name: string;
    dates: { serviceDate: string; label: string; counts: GridCounts }[];
  }[];
  unansweredPeople: number;
};

function asDate(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function asDateList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asDate).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (typeof value !== "string") return [];
  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, "").slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
}

function dbError(
  error: { code?: string; message?: string } | null,
  messages: { conflict?: string; check?: string } = {}
): Fail | null {
  if (!error) return null;
  log(error.message ?? "write");
  if (error.code === "23505") return fail(409, "conflict", messages.conflict ?? "That is already saved.");
  if (error.code === "23503") return fail(400, "invalid_input", "That person is not in Missio.");
  if (error.code === "23514") return fail(400, "invalid_input", messages.check ?? "Check the fields and try again.");
  return fail(500, "server_error", "Volunteers aren't available right now.");
}

async function directoryByContact(supabase: Client, orgId: string, contactIds: string[]) {
  const names = new Map<string, { name: string; firstName: string }>();
  if (contactIds.length === 0) return names;
  const { data, error } = await supabase
    .from("org_people_directory")
    .select("contact_id, first_name, last_name, preferred_name")
    .eq("org_id", orgId)
    .in("contact_id", contactIds);
  if (error) {
    log(error.message ?? "directory");
    return { error: fail(500, "server_error", "Volunteers aren't available right now.") };
  }
  for (const row of (data ?? []) as Array<{
    contact_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    preferred_name?: string | null;
  }>) {
    if (!row.contact_id) continue;
    names.set(row.contact_id, {
      name: directoryName(row),
      firstName: publicFirstName(row),
    });
  }
  return names;
}

function personFrom(
  contactId: string,
  names: Map<string, { name: string; firstName: string }>
): VolunteerPerson {
  const found = names.get(contactId);
  return {
    contactId,
    name: found?.name ?? "Former member",
    firstName: found?.firstName ?? "there",
  };
}

type TeamRows = {
  teams: { id: string; name: string }[];
  members: { team_id: string; contact_id: string }[];
  leaders: { team_id: string; contact_id: string }[];
};

async function loadTeamRows(supabase: Client, orgId: string): Promise<TeamRows | Fail> {
  const teams = await supabase.from("missio_teams").select("id, name").eq("org_id", orgId).order("name");
  if (teams.error) return fail(500, "server_error", "Volunteers aren't available right now.");
  const teamList = (teams.data ?? []) as { id: string; name: string }[];
  const teamIds = teamList.map((team) => team.id);
  if (teamIds.length === 0) return { teams: [], members: [], leaders: [] };
  const [members, leaders] = await Promise.all([
    supabase.from("missio_team_members").select("team_id, contact_id").in("team_id", teamIds),
    supabase.from("missio_team_leaders").select("team_id, contact_id").in("team_id", teamIds),
  ]);
  if (members.error || leaders.error) {
    log(members.error?.message ?? leaders.error?.message ?? "teams");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  return {
    teams: teamList,
    members: (members.data ?? []) as { team_id: string; contact_id: string }[],
    leaders: (leaders.data ?? []) as { team_id: string; contact_id: string }[],
  };
}

function rosterIds(rows: TeamRows): string[] {
  return [
    ...new Set([
      ...rows.members.map((row) => row.contact_id),
      ...rows.leaders.map((row) => row.contact_id),
    ]),
  ];
}

export async function loadVolunteers(
  supabase: Client,
  orgId: string,
  requestId?: string | null
): Promise<Ok<VolunteersSnapshot> | Fail> {
  const teamRows = await loadTeamRows(supabase, orgId);
  if ("status" in teamRows) return teamRows;

  const requestsQuery = await supabase
    .from("availability_requests")
    .select("id, starts_on, ends_on, service_dates, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (requestsQuery.error) {
    log(requestsQuery.error.message ?? "requests");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  const requests: VolunteerRequest[] = ((requestsQuery.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    startsOn: asDate(row.starts_on),
    endsOn: asDate(row.ends_on),
    serviceDates: asDateList(row.service_dates),
    createdAt: String(row.created_at ?? ""),
  }));

  let selected: VolunteerRequest | null = null;
  if (requestId) {
    selected = requests.find((request) => request.id === requestId) ?? null;
    if (!selected) return fail(404, "not_found", "That request is not in Missio.");
  } else {
    selected = requests[0] ?? null;
  }

  const contactIds = rosterIds(teamRows);
  const namesResult = await directoryByContact(supabase, orgId, contactIds);
  if ("error" in namesResult) return namesResult.error;
  const names = namesResult;

  const teams: VolunteerTeam[] = teamRows.teams.map((team) => ({
    id: team.id,
    name: team.name,
    leaders: teamRows.leaders
      .filter((row) => row.team_id === team.id)
      .map((row) => personFrom(row.contact_id, names)),
    members: teamRows.members
      .filter((row) => row.team_id === team.id)
      .map((row) => personFrom(row.contact_id, names)),
  }));

  let responses: GridResponse[] = [];
  if (selected) {
    const responseQuery = await supabase
      .from("availability_responses")
      .select("contact_id, service_date, status")
      .eq("request_id", selected.id);
    if (responseQuery.error) {
      log(responseQuery.error.message ?? "responses");
      return fail(500, "server_error", "Volunteers aren't available right now.");
    }
    responses = ((responseQuery.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        contactId: String(row.contact_id),
        serviceDate: asDate(row.service_date),
        status: row.status as AvailabilityChoice,
      }))
      .filter((row) => row.status === "available" || row.status === "unavailable" || row.status === "maybe");
  }

  const gridInput = teams.map((team) => ({
    id: team.id,
    name: team.name,
    memberIds: team.members.map((person) => person.contactId),
    leaderIds: team.leaders.map((person) => person.contactId),
  }));
  const aggregated = aggregateAvailabilityGrid({
    teams: gridInput,
    dates: selected?.serviceDates ?? [],
    responses,
  });
  const grid = aggregated.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    dates: team.dates.map((cell) => ({
      serviceDate: cell.serviceDate,
      label: formatServiceLabel(cell.serviceDate, "short"),
      counts: cell.counts,
    })),
  }));

  const unansweredPeople = selected
    ? unansweredContacts({
        contactIds: gridInput.flatMap((team) => teamRoster(team)),
        dates: selected.serviceDates,
        responses,
      }).length
    : 0;

  return {
    ok: true,
    body: {
      teams,
      requests,
      selectedRequestId: selected?.id ?? null,
      grid,
      unansweredPeople,
    },
  };
}

export async function createAvailabilityRequest(
  supabase: Client,
  orgId: string,
  userId: string,
  input: CreateRequestInput
): Promise<Ok<{ id: string }> | Fail> {
  const serviceDates = [...new Set(input.serviceDates)].sort();
  const { data, error } = await supabase
    .from("availability_requests")
    .insert({
      org_id: orgId,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      service_dates: serviceDates,
      created_by: userId,
    })
    .select("id")
    .single();
  const failed = dbError(error, { check: "Check the dates and try again." });
  if (failed) return failed;
  if (!data?.id) return fail(500, "server_error", "Volunteers aren't available right now.");
  return { ok: true, body: { id: data.id as string } };
}

export async function createTeam(supabase: Client, orgId: string, name: string): Promise<Ok<{ id: string }> | Fail> {
  const { data, error } = await supabase
    .from("missio_teams")
    .insert({ org_id: orgId, name })
    .select("id")
    .single();
  const failed = dbError(error, { conflict: "A team with that name already exists.", check: "Enter a team name." });
  if (failed) return failed;
  if (!data?.id) return fail(500, "server_error", "Volunteers aren't available right now.");
  return { ok: true, body: { id: data.id as string } };
}

export async function renameTeam(
  supabase: Client,
  orgId: string,
  teamId: string,
  name: string
): Promise<Ok<{ id: string }> | Fail> {
  const { data, error } = await supabase
    .from("missio_teams")
    .update({ name })
    .eq("id", teamId)
    .eq("org_id", orgId)
    .select("id");
  const failed = dbError(error, { conflict: "A team with that name already exists.", check: "Enter a team name." });
  if (failed) return failed;
  const row = (data ?? [])[0] as { id?: string } | undefined;
  if (!row?.id) return fail(404, "not_found", "That team is not in Missio.");
  return { ok: true, body: { id: row.id } };
}

export async function deleteTeam(supabase: Client, orgId: string, teamId: string): Promise<Ok<{ id: string }> | Fail> {
  const { data, error } = await supabase.from("missio_teams").delete().eq("id", teamId).eq("org_id", orgId).select("id");
  if (error) {
    log(error.message ?? "delete team");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  const row = (data ?? [])[0] as { id?: string } | undefined;
  if (!row?.id) return fail(404, "not_found", "That team is not in Missio.");
  return { ok: true, body: { id: row.id } };
}

async function assertInDirectory(supabase: Client, orgId: string, contactId: string): Promise<Fail | null> {
  const { data, error } = await supabase
    .from("org_people_directory")
    .select("contact_id")
    .eq("org_id", orgId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) {
    log(error.message ?? "directory person");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  if (!data) return fail(400, "invalid_input", "That person is not in Missio.");
  return null;
}

async function assertTeam(supabase: Client, orgId: string, teamId: string): Promise<Fail | null> {
  const { data, error } = await supabase.from("missio_teams").select("id").eq("id", teamId).eq("org_id", orgId).maybeSingle();
  if (error) {
    log(error.message ?? "team");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  if (!data) return fail(404, "not_found", "That team is not in Missio.");
  return null;
}

export async function addTeamPerson(
  supabase: Client,
  orgId: string,
  teamId: string,
  contactId: string,
  kind: "members" | "leaders"
): Promise<Ok<{ contactId: string }> | Fail> {
  const team = await assertTeam(supabase, orgId, teamId);
  if (team) return team;
  const person = await assertInDirectory(supabase, orgId, contactId);
  if (person) return person;
  const table = kind === "members" ? "missio_team_members" : "missio_team_leaders";
  const { error } = await supabase.from(table).insert({ team_id: teamId, contact_id: contactId });
  const failed = dbError(error, { conflict: "That person is already on this team." });
  if (failed) return failed;
  return { ok: true, body: { contactId } };
}

export async function removeTeamPerson(
  supabase: Client,
  orgId: string,
  teamId: string,
  contactId: string,
  kind: "members" | "leaders"
): Promise<Ok<{ contactId: string }> | Fail> {
  const team = await assertTeam(supabase, orgId, teamId);
  if (team) return team;
  const table = kind === "members" ? "missio_team_members" : "missio_team_leaders";
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq("team_id", teamId)
    .eq("contact_id", contactId)
    .select("contact_id");
  if (error) {
    log(error.message ?? "remove person");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  const row = (data ?? [])[0] as { contact_id?: string } | undefined;
  if (!row?.contact_id) return fail(404, "not_found", "That person is not on this team.");
  return { ok: true, body: { contactId } };
}

async function loadOwnedRequest(supabase: Client, orgId: string, requestId: string): Promise<VolunteerRequest | Fail> {
  const { data, error } = await supabase
    .from("availability_requests")
    .select("id, starts_on, ends_on, service_dates, created_at")
    .eq("id", requestId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    log(error.message ?? "request");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  if (!data) return fail(404, "not_found", "That request is not in Missio.");
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    startsOn: asDate(row.starts_on),
    endsOn: asDate(row.ends_on),
    serviceDates: asDateList(row.service_dates),
    createdAt: String(row.created_at ?? ""),
  };
}

async function assertOnRoster(supabase: Client, orgId: string, contactId: string): Promise<Fail | null> {
  const rows = await loadTeamRows(supabase, orgId);
  if ("status" in rows) return rows;
  if (!rosterIds(rows).includes(contactId)) return fail(404, "not_found", "That person is not on a team.");
  return null;
}

export async function issuePersonalLink(
  supabase: Client,
  orgId: string,
  requestId: string,
  contactId: string,
  origin: string
): Promise<Ok<{ url: string }> | Fail> {
  const request = await loadOwnedRequest(supabase, orgId, requestId);
  if ("status" in request) return request;
  const roster = await assertOnRoster(supabase, orgId, contactId);
  if (roster) return roster;
  const admin = createAdminClient();
  const issued = await writeToken(admin, request, contactId, origin);
  return issued;
}

async function writeToken(
  admin: Client,
  request: VolunteerRequest,
  contactId: string,
  origin: string
): Promise<Ok<{ url: string; firstName: string }> | Fail> {
  const generated = generateAvailabilityToken();
  const record = tokenHashRecord(generated.raw, tokenExpiresAt(request.serviceDates));
  const { error } = await admin.from("availability_tokens").upsert(
    {
      request_id: request.id,
      contact_id: contactId,
      token_hash: record.token_hash,
      expires_at: record.expires_at,
    },
    { onConflict: "request_id,contact_id" }
  );
  if (error) {
    log(error.message ?? "token");
    return fail(500, "server_error", "The link didn't get written.");
  }
  return { ok: true, body: { url: personalAvailabilityUrl(origin, generated.raw), firstName: "" } };
}

export async function prepareNudge(
  supabase: Client,
  orgId: string,
  requestId: string,
  origin: string
): Promise<Ok<{ whatsapp: string; email: string; count: number }> | Fail> {
  const request = await loadOwnedRequest(supabase, orgId, requestId);
  if ("status" in request) return request;
  const rows = await loadTeamRows(supabase, orgId);
  if ("status" in rows) return rows;
  const responseQuery = await supabase
    .from("availability_responses")
    .select("contact_id, service_date")
    .eq("request_id", request.id);
  if (responseQuery.error) {
    log(responseQuery.error.message ?? "nudge responses");
    return fail(500, "server_error", "Volunteers aren't available right now.");
  }
  const responses = ((responseQuery.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    contactId: String(row.contact_id),
    serviceDate: asDate(row.service_date),
  }));
  const pending = unansweredContacts({
    contactIds: rosterIds(rows),
    dates: request.serviceDates,
    responses,
  });
  const namesResult = await directoryByContact(supabase, orgId, pending);
  if ("error" in namesResult) return namesResult.error;

  const admin = createAdminClient();
  const people: NudgePerson[] = [];
  for (const contactId of pending) {
    const written = await writeToken(admin, request, contactId, origin);
    if (!written.ok) return written;
    people.push({
      firstName: namesResult.get(contactId)?.firstName ?? "there",
      url: written.body.url,
    });
  }
  const labels = request.serviceDates.map((date) => formatServiceLabel(date, "long"));
  const bundled = bundleNudges(people, labels);
  return { ok: true, body: bundled };
}

type TokenRow = { request_id: string; contact_id: string; expires_at: string; token_hash: string };

async function readToken(admin: Client, raw: string, now: Date): Promise<Ok<TokenRow> | Fail> {
  if (!AVAILABILITY_TOKEN_PATTERN.test(raw)) {
    return fail(404, "invalid_token", "This link doesn't work.");
  }
  const tokenHash = tokenHashRecord(raw, new Date(0).toISOString()).token_hash;
  const { data, error } = await admin
    .from("availability_tokens")
    .select("request_id, contact_id, expires_at, token_hash")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    log(error.message ?? "token lookup");
    return fail(500, "server_error", "Missio didn't load this link.");
  }
  const row = data as TokenRow | null;
  if (!row || !verifyAvailabilityToken(raw, row.token_hash)) {
    return fail(404, "invalid_token", "This link doesn't work.");
  }
  if (isTokenExpired(row.expires_at, now)) {
    return fail(410, "expired", "This link has expired.");
  }
  return { ok: true, body: row };
}

export async function loadPublicAvailability(
  admin: Client,
  raw: string,
  now = new Date()
): Promise<Ok<PublicAvailabilityView> | Fail> {
  const token = await readToken(admin, raw, now);
  if (!token.ok) return token;
  const requestQuery = await admin
    .from("availability_requests")
    .select("service_dates")
    .eq("id", token.body.request_id)
    .maybeSingle();
  if (requestQuery.error || !requestQuery.data) {
    log(requestQuery.error?.message ?? "public request");
    return fail(500, "server_error", "Missio didn't load this link.");
  }
  const nameQuery = await admin
    .from("contacts")
    .select(PUBLIC_NAME_COLUMNS)
    .eq("id", token.body.contact_id)
    .maybeSingle();
  if (nameQuery.error) {
    log(nameQuery.error.message ?? "public name");
    return fail(500, "server_error", "Missio didn't load this link.");
  }
  const responseQuery = await admin
    .from("availability_responses")
    .select("service_date, status, note")
    .eq("request_id", token.body.request_id)
    .eq("contact_id", token.body.contact_id);
  if (responseQuery.error) {
    log(responseQuery.error.message ?? "public responses");
    return fail(500, "server_error", "Missio didn't load this link.");
  }
  const name = (nameQuery.data ?? {}) as { first_name?: string | null; preferred_name?: string | null };
  const responses = ((responseQuery.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      serviceDate: asDate(row.service_date),
      status: row.status as AvailabilityChoice,
      note: typeof row.note === "string" ? row.note : null,
    }))
    .filter((row) => row.status === "available" || row.status === "unavailable" || row.status === "maybe");
  return {
    ok: true,
    body: toPublicAvailability({
      firstName: name.first_name ?? null,
      preferredName: name.preferred_name ?? null,
      serviceDates: asDateList((requestQuery.data as { service_dates?: unknown }).service_dates),
      responses,
      today: johannesburgToday(now),
    }),
  };
}

export async function savePublicAvailability(
  admin: Client,
  raw: string,
  input: PublicSaveInput,
  now = new Date()
): Promise<Ok<{ serviceDate: string; status: AvailabilityChoice; note: string | null; saved: true }> | Fail> {
  const token = await readToken(admin, raw, now);
  if (!token.ok) return token;
  const today = johannesburgToday(now);
  if (!canEditAvailability(input.serviceDate, today)) {
    return fail(400, "closed", "That Sunday has passed.");
  }
  const requestQuery = await admin
    .from("availability_requests")
    .select("service_dates")
    .eq("id", token.body.request_id)
    .maybeSingle();
  if (requestQuery.error || !requestQuery.data) {
    log(requestQuery.error?.message ?? "save request");
    return fail(500, "server_error", "That Sunday didn't save.");
  }
  const dates = asDateList((requestQuery.data as { service_dates?: unknown }).service_dates);
  if (!dates.includes(input.serviceDate)) {
    return fail(400, "invalid_input", "That Sunday is not on this link.");
  }
  const note = input.note?.trim() ? input.note.trim() : null;
  const { error } = await admin.from("availability_responses").upsert(
    {
      request_id: token.body.request_id,
      contact_id: token.body.contact_id,
      service_date: input.serviceDate,
      status: input.status,
      note,
    },
    { onConflict: "request_id,contact_id,service_date" }
  );
  if (error) {
    log(error.message ?? "save response");
    if (error.code === "23514") return fail(400, "closed", "That Sunday has passed.");
    return fail(500, "server_error", "That Sunday didn't save.");
  }
  return { ok: true, body: { serviceDate: input.serviceDate, status: input.status, note, saved: true } };
}

export function adminClient(): Client {
  return createAdminClient();
}
