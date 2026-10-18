// The org chart as data (frames 40a / 41a). Everything here is READ from the
// rosters, reporting lines and OKRs — the chart stores nothing but layout
// (doc 18, migration 250). Pure functions, so the rules are testable without
// a database: services/org-chart.ts fetches the rows, this shapes them.
//
// "No ratio, no bar" (lib/okrs/progress.ts) holds here too. The design file
// puts a percentage on every row, but its numbers are sample data; most real
// key results are prose, so a percentage only appears where a metric exists.

import type { OkrStatus } from "@/types/okrs";
import { krProgress } from "@/lib/okrs/progress";

export type OrgState = "complete" | "moving" | "progress" | "stuck" | "notstarted";
export type OrgCluster = "leadership" | "outward" | "inward" | "backbone" | "alongside" | "parttime" | "unplaced";
export type Direction = "presence" | "formation" | "mission" | "multiplication" | "care";

/** FFSA's rhythm plus the year's theme — the left-hand column of 40a. */
export const DIRECTIONS: { key: Direction; code: string; title: string; def: string }[] = [
  { key: "presence", code: "01", title: "Presence", def: "Life with God." },
  { key: "formation", code: "02", title: "Formation", def: "Discipleship, holiness, maturity, and responsibility." },
  { key: "mission", code: "03", title: "Mission", def: "The overflow of communion with Jesus into evangelism, mercy, Bible engagement, and sending." },
  { key: "multiplication", code: "04", title: "Multiplication", def: "The long term fruit: leaders raised, teams sent, churches planted, bases pioneered, and ministries reproduced." },
  { key: "care", code: "2026", title: "Building with care", def: "The theme of the year: depth before width, governance worthy of trust, shared labour." },
];

export const STATE_LABEL: Record<OrgState, string> = {
  complete: "COMPLETE",
  moving: "MOVING FORWARD",
  progress: "IN PROGRESS",
  stuck: "STUCK",
  notstarted: "NOT STARTED",
};

export const CLUSTER_LABEL: Record<OrgCluster, string> = {
  leadership: "Governance · Senior oversight",
  outward: "Outward · Mission",
  inward: "Inward · Formation",
  backbone: "Backbone · Support",
  alongside: "Alongside",
  parttime: "Part-time ministries",
  unplaced: "Not placed yet",
};

// ── Raw rows, as the loader hands them over ──────────────────────────────

export type RawTeam = {
  id: string;
  name: string;
  slug: string;
  cluster: string | null;
  parent_id: string | null;
  purpose: string | null;
  description: string | null;
  ministry_type: string | null;
  sort_order: number;
};
export type RawMember = {
  id: string;
  staff_ministry_id: string;
  user_id: string;
  member_role: string;
  is_point_leader: boolean;
  role_title: string | null;
  responsibilities: string[] | null;
  share_pct: number | null;
  staff_kind: string | null;
  subcategories: string[];
};
export type RawPerson = { id: string; name: string; job_title: string | null };
export type RawLine = { staff_ministry_id: string; leader_user_id: string; kind: string; label: string | null };
export type RawKr = {
  id: string;
  description: string;
  position: number;
  current_status: OkrStatus;
  current_value: number | null;
  metric_start: number | null;
  metric_target: number | null;
  metric_unit: string | null;
  owner_user_id: string | null;
  owner_note: string | null;
  last_checkin_at: string | null;
};
export type RawObjective = {
  id: string;
  staff_ministry_id: string;
  title: string;
  description: string | null;
  direction: string | null;
  position: number;
  krs: RawKr[];
};
export type RawSchool = { id: string; name: string; students: number };

export type OrgInput = {
  teams: RawTeam[];
  members: RawMember[];
  people: RawPerson[];
  lines: RawLine[];
  objectives: RawObjective[];
  shepherds: { staff_ministry_id: string; user_id: string }[];
  schools: RawSchool[];
  cycleName: string | null;
  /** First day of the month whose OKR update is due, as YYYY-MM-DD. */
  updateMonthStart: string;
};

// ── The shaped model the canvas draws ────────────────────────────────────

export type OrgKr = {
  id: string;
  text: string;
  pct: number | null;
  state: OrgState;
  ownerId: string | null;
  ownerName: string | null;
};
export type OrgObjective = {
  id: string;
  title: string;
  /** "Why this matters", when the objective has one. */
  description: string | null;
  direction: Direction | null;
  pct: number | null;
  state: OrgState;
  krs: OrgKr[];
};
export type OrgMember = {
  membershipId: string;
  userId: string;
  name: string;
  /** role_title, else the person's job title — what the chart shows. */
  title: string | null;
  /** role_title alone — what edit mode edits. */
  roleTitle: string | null;
  sharePct: number | null;
  staffKind: "staff" | "volunteer";
  responsibilities: string[];
  isLead: boolean;
  /** Other team ids this person is on. */
  alsoOn: string[];
};
export type OrgLine = { userId: string; name: string; kind: "oversees" | "integrates" | "alongside"; label: string | null };
export type OrgTeam = {
  id: string;
  name: string;
  cluster: OrgCluster;
  /** The stored cluster, null when unset — what edit mode edits. */
  clusterRaw: string | null;
  parentId: string | null;
  purpose: string | null;
  /** The stored purpose alone (purpose falls back to the description). */
  purposeRaw: string | null;
  shepherdId: string | null;
  leads: string[];
  headcount: number;
  groups: { name: string; people: string[] }[];
  members: OrgMember[];
  objectives: OrgObjective[];
  shepherd: string | null;
  /** Any check-in on this team's key results since the update month began. */
  updated: boolean;
  /** Reporting lines INTO this team. */
  lines: OrgLine[];
};
export type OrgLeader = { userId: string; name: string; tag: string; title: string | null };
export type OrgShared = { a: string; b: string; people: string[] };
export type OrgDirectionSummary = { key: Direction; code: string; title: string; def: string; pct: number | null; state: OrgState; feeders: { teamId: string; objectiveId: string }[] };

export type OrgModel = {
  cycleName: string | null;
  updateMonthLabel: string;
  teams: OrgTeam[];
  leadershipId: string | null;
  missioId: string | null;
  leaders: OrgLeader[];
  shared: OrgShared[];
  directions: OrgDirectionSummary[];
  schools: RawSchool[];
  staffCount: number;
};

// ── Rules ────────────────────────────────────────────────────────────────

const FROM_STATUS: Record<OkrStatus, OrgState> = {
  complete: "complete",
  moving_forward: "moving",
  in_progress: "progress",
  stuck: "stuck",
  not_started: "notstarted",
};

export function toOrgState(s: OkrStatus): OrgState {
  return FROM_STATUS[s] ?? "notstarted";
}

/**
 * One state for a group of states. Stuck wins — it is the thing a leader
 * needs to see. All complete is complete. Anything moving (or partly done)
 * is moving; anything begun is in progress; otherwise not started.
 */
export function rollUpState(states: OrgState[]): OrgState {
  if (states.length === 0) return "notstarted";
  if (states.includes("stuck")) return "stuck";
  if (states.every((s) => s === "complete")) return "complete";
  if (states.some((s) => s === "moving" || s === "complete")) return "moving";
  if (states.includes("progress")) return "progress";
  return "notstarted";
}

/** Mean of the percentages that exist; null when none do — no ratio, no bar. */
export function meanPct(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

const CLUSTERS = new Set(["leadership", "outward", "inward", "backbone", "alongside"]);
const DIRECTION_KEYS = new Set(DIRECTIONS.map((d) => d.key));
const NOT_A_TEAM = new Set(["no_ministry"]);

function clusterOf(t: RawTeam): OrgCluster {
  if (t.cluster && CLUSTERS.has(t.cluster)) return t.cluster as OrgCluster;
  if (t.ministry_type === "part_time") return "parttime";
  return "unplaced";
}

// Fixed, not Intl: en-GB writes "Sept", and the server and browser can
// disagree on locale data.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function monthLabel(isoDate: string): string {
  return MONTHS[Number(isoDate.split("-")[1]) - 1];
}

export function buildOrgModel(input: OrgInput): OrgModel {
  const teams = input.teams.filter((t) => !NOT_A_TEAM.has(t.slug));
  const teamIds = new Set(teams.map((t) => t.id));
  const person = new Map(input.people.map((p) => [p.id, p]));
  const nameOf = (id: string) => person.get(id)?.name ?? "Someone";

  const membersByTeam = new Map<string, RawMember[]>();
  const teamsByUser = new Map<string, Set<string>>();
  for (const m of input.members) {
    if (!teamIds.has(m.staff_ministry_id)) continue;
    (membersByTeam.get(m.staff_ministry_id) ?? membersByTeam.set(m.staff_ministry_id, []).get(m.staff_ministry_id)!).push(m);
    (teamsByUser.get(m.user_id) ?? teamsByUser.set(m.user_id, new Set()).get(m.user_id)!).add(m.staff_ministry_id);
  }

  const objectivesByTeam = new Map<string, OrgObjective[]>();
  const updatedTeams = new Set<string>();
  for (const o of [...input.objectives].sort((a, b) => a.position - b.position)) {
    if (!teamIds.has(o.staff_ministry_id)) continue;
    const krs: OrgKr[] = [...o.krs]
      .sort((a, b) => a.position - b.position)
      .map((kr) => {
        if (kr.last_checkin_at && kr.last_checkin_at.slice(0, 10) >= input.updateMonthStart) {
          updatedTeams.add(o.staff_ministry_id);
        }
        return {
          id: kr.id,
          text: kr.description,
          pct: krProgress(kr) ? Math.round(krProgress(kr)!.pct) : null,
          state: toOrgState(kr.current_status),
          ownerId: kr.owner_user_id,
          ownerName: kr.owner_user_id ? nameOf(kr.owner_user_id) : kr.owner_note?.trim() || null,
        };
      });
    const objective: OrgObjective = {
      id: o.id,
      title: o.title,
      description: o.description?.trim() || null,
      direction: o.direction && DIRECTION_KEYS.has(o.direction as Direction) ? (o.direction as Direction) : null,
      pct: meanPct(krs.map((k) => k.pct)),
      state: rollUpState(krs.map((k) => k.state)),
      krs,
    };
    (objectivesByTeam.get(o.staff_ministry_id) ?? objectivesByTeam.set(o.staff_ministry_id, []).get(o.staff_ministry_id)!).push(objective);
  }

  const shepherdOf = new Map(input.shepherds.map((s) => [s.staff_ministry_id, s.user_id]));
  const linesByTeam = new Map<string, OrgLine[]>();
  for (const l of input.lines) {
    if (!teamIds.has(l.staff_ministry_id)) continue;
    if (l.kind !== "oversees" && l.kind !== "integrates" && l.kind !== "alongside") continue;
    (linesByTeam.get(l.staff_ministry_id) ?? linesByTeam.set(l.staff_ministry_id, []).get(l.staff_ministry_id)!).push({
      userId: l.leader_user_id,
      name: nameOf(l.leader_user_id),
      kind: l.kind,
      label: l.label,
    });
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  const shaped: OrgTeam[] = teams.map((t) => {
    const rows = membersByTeam.get(t.id) ?? [];
    const leads = rows
      .filter((m) => m.member_role === "leader")
      .sort((a, b) => Number(b.is_point_leader) - Number(a.is_point_leader))
      .map((m) => nameOf(m.user_id));
    const members: OrgMember[] = rows
      .map((m) => ({
        membershipId: m.id,
        userId: m.user_id,
        name: nameOf(m.user_id),
        title: m.role_title?.trim() || person.get(m.user_id)?.job_title?.trim() || null,
        roleTitle: m.role_title?.trim() || null,
        sharePct: m.share_pct ?? null,
        staffKind: m.staff_kind === "volunteer" ? ("volunteer" as const) : ("staff" as const),
        responsibilities: (m.responsibilities ?? []).filter((r) => r.trim()),
        isLead: m.member_role === "leader",
        alsoOn: [...(teamsByUser.get(m.user_id) ?? [])].filter((id) => id !== t.id),
      }))
      .sort((a, b) => Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name));

    // Groups are the roster's own sub-categories; anyone in none is "Team".
    const groups = new Map<string, string[]>();
    for (const m of rows) {
      const names = m.subcategories.length ? m.subcategories : ["Team"];
      for (const g of names) (groups.get(g) ?? groups.set(g, []).get(g)!).push(nameOf(m.user_id));
    }

    return {
      id: t.id,
      name: t.name,
      cluster: clusterOf(t),
      clusterRaw: t.cluster && CLUSTERS.has(t.cluster) ? t.cluster : null,
      parentId: t.parent_id && teamIds.has(t.parent_id) ? t.parent_id : null,
      purpose: t.purpose?.trim() || t.description?.trim() || null,
      purposeRaw: t.purpose?.trim() || null,
      shepherdId: shepherdOf.get(t.id) ?? null,
      leads,
      headcount: new Set(rows.map((m) => m.user_id)).size,
      groups: [...groups.entries()]
        .map(([name, people]) => ({ name, people: people.sort() }))
        .sort((a, b) => (a.name === "Team" ? 1 : b.name === "Team" ? -1 : a.name.localeCompare(b.name))),
      members,
      objectives: objectivesByTeam.get(t.id) ?? [],
      shepherd: shepherdOf.has(t.id) ? nameOf(shepherdOf.get(t.id)!) : null,
      updated: updatedTeams.has(t.id),
      lines: (linesByTeam.get(t.id) ?? []).sort(byName),
    };
  });

  const leadership = shaped.find((t) => t.cluster === "leadership") ?? null;
  const missio = shaped.find((t) => t.cluster === "alongside") ?? null;

  // The Leadership team's own rows: its members, the Integrator tagged.
  const integrators = new Set(input.lines.filter((l) => l.kind === "integrates").map((l) => l.leader_user_id));
  const leaders: OrgLeader[] = (leadership?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.name,
    tag: integrators.has(m.userId) ? "INTEGRATOR" : (m.title ?? "").toUpperCase().slice(0, 22),
    title: m.title,
  }));

  // A person on two teams draws a dotted line between them. Leadership and
  // Missio are left out: their lines are reporting and "alongside", and every
  // leader is on another team, which would wire Leadership to everything.
  const skip = new Set([leadership?.id, missio?.id].filter(Boolean) as string[]);
  const pairs = new Map<string, OrgShared>();
  for (const [userId, set] of teamsByUser) {
    const ids = [...set].filter((id) => !skip.has(id)).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] + "|" + ids[j];
        const p = pairs.get(key) ?? pairs.set(key, { a: ids[i], b: ids[j], people: [] }).get(key)!;
        p.people.push(nameOf(userId));
      }
    }
  }

  const directions: OrgDirectionSummary[] = DIRECTIONS.map((d) => {
    const feeders = shaped.flatMap((t) =>
      t.objectives.filter((o) => o.direction === d.key).map((o) => ({ teamId: t.id, objectiveId: o.id, o }))
    );
    return {
      ...d,
      pct: meanPct(feeders.map((f) => f.o.pct)),
      state: rollUpState(feeders.map((f) => f.o.state)),
      feeders: feeders.map(({ teamId, objectiveId }) => ({ teamId, objectiveId })),
    };
  });

  return {
    cycleName: input.cycleName,
    updateMonthLabel: monthLabel(input.updateMonthStart),
    teams: shaped,
    leadershipId: leadership?.id ?? null,
    missioId: missio?.id ?? null,
    leaders,
    shared: [...pairs.values()].map((p) => ({ ...p, people: p.people.sort() })),
    directions,
    schools: input.schools,
    staffCount: teamsByUser.size,
  };
}

/** The month whose update is due: the previous calendar month, in SAST. */
export function updateMonthStart(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value); // 1-12, SAST
  const d = new Date(Date.UTC(year, month - 2, 1));
  return d.toISOString().slice(0, 10);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
