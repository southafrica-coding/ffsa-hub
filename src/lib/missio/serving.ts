import type { MissioPersonInterest, MissioPersonTeam, MissioServingCounts } from "@/lib/missio/types";

// Serving labels on the People list. Read only: this module never writes a
// team, a member, a leader or an interest.
//
// Where each label comes from (nothing is guessed from notes, house names,
// marital status, contact labels or Planning Center):
//   Serves {team}       a missio_team_members row for that team
//   Leads {team}        a missio_team_leaders row (wins over a member row)
//   Interested · {name} a missio_serving_interests row with status = 'new'
//                       and a contact_id. Hidden for a team they're already on.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type RosterTeam = { id: string; name: string };
export type RosterLink = { team_id: string; contact_id: string };
export type InterestRow = { contact_id: string | null; status: string; teams: unknown };

export type PersonServing = { teams: MissioPersonTeam[]; interestTeams: MissioPersonInterest[] };

export type ServingIndex = {
  teams: RosterTeam[];
  byContact: Map<string, PersonServing>;
};

export type ServesFilter = "yes" | "no" | "interested";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The WhatsApp bot's fallback labels (used while missio_teams is empty) that
 * mean a starter team. Prayer is deliberately not here: there is no Prayer
 * starter team, and we don't invent one.
 */
export const INTEREST_ALIASES: Readonly<Record<string, string>> = {
  "worship / band": "worship",
  "production / tech": "production",
};

function key(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/**
 * The roster team an interest entry points at, or null. By a real team id
 * first, then the name (trimmed, any case), then the bot alias map.
 */
export function matchInterestTeam(entry: { id?: unknown; name?: unknown }, teams: RosterTeam[]): RosterTeam | null {
  if (typeof entry.id === "string" && UUID.test(entry.id)) {
    const byId = teams.find((team) => team.id.toLowerCase() === (entry.id as string).toLowerCase());
    if (byId) return byId;
  }
  if (typeof entry.name !== "string" || !entry.name.trim()) return null;
  const wanted = key(entry.name);
  const direct = teams.find((team) => key(team.name) === wanted);
  if (direct) return direct;
  const alias = INTEREST_ALIASES[wanted];
  return alias ? teams.find((team) => key(team.name) === alias) ?? null : null;
}

function interestEntries(value: unknown): Array<{ id?: unknown; name?: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { id?: unknown; name?: unknown } => Boolean(item) && typeof item === "object");
}

/** Build every person's chips from the org's roster and its new interests. */
export function buildServingIndex(input: {
  teams: RosterTeam[];
  members: RosterLink[];
  leaders: RosterLink[];
  interests: InterestRow[];
}): ServingIndex {
  const teams = [...input.teams].sort(byName);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const roles = new Map<string, Map<string, boolean>>();

  const add = (link: RosterLink, leads: boolean) => {
    if (!teamById.has(link.team_id) || !link.contact_id) return;
    const mine = roles.get(link.contact_id) ?? new Map<string, boolean>();
    mine.set(link.team_id, leads || mine.get(link.team_id) === true);
    roles.set(link.contact_id, mine);
  };
  for (const row of input.members) add(row, false);
  for (const row of input.leaders) add(row, true);

  const byContact = new Map<string, PersonServing>();
  const entry = (contactId: string) => {
    const existing = byContact.get(contactId);
    if (existing) return existing;
    const created: PersonServing = { teams: [], interestTeams: [] };
    byContact.set(contactId, created);
    return created;
  };

  for (const [contactId, mine] of roles) {
    entry(contactId).teams = [...mine.entries()]
      .map(([teamId, leads]) => ({ id: teamId, name: teamById.get(teamId)!.name, leads }))
      .sort(byName);
  }

  for (const row of input.interests) {
    if (row.status !== "new" || !row.contact_id) continue;
    const onTeams = roles.get(row.contact_id);
    for (const item of interestEntries(row.teams)) {
      const team = matchInterestTeam(item, teams);
      if (team && onTeams?.has(team.id)) continue;
      const name = team?.name ?? (typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Other");
      const person = entry(row.contact_id);
      const seen = person.interestTeams.some((existing) =>
        team ? existing.teamId === team.id : existing.teamId === null && key(existing.name) === key(name)
      );
      if (!seen) person.interestTeams.push({ name, teamId: team?.id ?? null });
    }
  }
  for (const person of byContact.values()) person.interestTeams.sort(byName);
  return { teams, byContact };
}

export function servingFor(index: ServingIndex, contactId: string): PersonServing {
  const found = index.byContact.get(contactId);
  return { teams: found?.teams ?? [], interestTeams: found?.interestTeams ?? [] };
}

/** serves and team AND together. No filter keeps everyone. */
export function matchesServing(
  index: ServingIndex,
  contactId: string,
  filter: { serves?: ServesFilter; team?: string }
): boolean {
  const person = servingFor(index, contactId);
  if (filter.serves === "yes" && person.teams.length === 0) return false;
  if (filter.serves === "no" && person.teams.length > 0) return false;
  if (filter.serves === "interested" && person.interestTeams.length === 0) return false;
  if (filter.team && !person.teams.some((team) => team.id === filter.team)) return false;
  return true;
}

/** Funnel counts over the people the list's campus/status/search kept. */
export function servingCounts(index: ServingIndex, contactIds: string[]): MissioServingCounts {
  let serves = 0;
  let interested = 0;
  const perTeam = new Map(index.teams.map((team) => [team.id, 0]));
  for (const contactId of new Set(contactIds)) {
    const person = servingFor(index, contactId);
    if (person.teams.length > 0) serves += 1;
    if (person.interestTeams.length > 0) interested += 1;
    for (const team of person.teams) perTeam.set(team.id, (perTeam.get(team.id) ?? 0) + 1);
  }
  const total = new Set(contactIds).size;
  return {
    serves,
    doesnt: total - serves,
    interested,
    teams: index.teams.map((team) => ({ id: team.id, name: team.name, count: perTeam.get(team.id) ?? 0 })),
  };
}

/**
 * The org's roster and its new interests, through the pastor's own client
 * (RLS: Missio pastors only). Null when any read fails, so the list says
 * nothing about serving rather than "doesn't serve".
 */
export async function loadServingIndex(supabase: Client, orgId: string): Promise<ServingIndex | null> {
  const teamsRead = await supabase.from("missio_teams").select("id, name").eq("org_id", orgId);
  if (teamsRead.error) {
    console.error("[missio] serving teams failed", teamsRead.error.message ?? "query error");
    return null;
  }
  const teams = ((teamsRead.data ?? []) as RosterTeam[]).filter((team) => team.id && typeof team.name === "string");
  const teamIds = teams.map((team) => team.id);

  // Rows without a contact_id (a thread not yet tied to one person) are
  // skipped in buildServingIndex: they can't put a chip on anyone.
  const [members, leaders, interests] = await Promise.all([
    teamIds.length
      ? supabase.from("missio_team_members").select("team_id, contact_id").in("team_id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("missio_team_leaders").select("team_id, contact_id").in("team_id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("missio_serving_interests")
      .select("contact_id, status, teams")
      .eq("org_id", orgId)
      .eq("status", "new"),
  ]);
  for (const [label, read] of [
    ["members", members],
    ["leaders", leaders],
    ["interests", interests],
  ] as const) {
    if (read.error) {
      console.error(`[missio] serving ${label} failed`, read.error.message ?? "query error");
      return null;
    }
  }
  return buildServingIndex({
    teams,
    members: (members.data ?? []) as RosterLink[],
    leaders: (leaders.data ?? []) as RosterLink[],
    interests: (interests.data ?? []) as InterestRow[],
  });
}
