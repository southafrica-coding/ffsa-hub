// In-memory staff ministries, service owners, rocks and budgets for the
// department route and access tests. One world, many callers: rows carry
// user_id and the resolver honours eq / in / is.

import type { FakeQuery, FakeResult } from "@/lib/testing/fake-supabase";
import { seedGrants } from "@/lib/services/seed";
import { currentQuarter } from "@/lib/departments/quarter";

export const MEDIA = "11111111-1111-4111-8111-111111111111";
export const HULK = "22222222-2222-4222-8222-222222222222";
export const LEADERSHIP = "33333333-3333-4333-8333-333333333333";
export const WORSHIP = "44444444-4444-4444-8444-444444444444";
export const OPERATIONS = "55555555-5555-4555-8555-555555555555";
export const FINANCE = "66666666-6666-4666-8666-666666666666";
export const WOVEN = "67676767-6767-4676-8676-676767676767";

export const LEADER = "77777777-7777-4777-8777-777777777777";
export const MEMBER = "88888888-8888-4888-8888-888888888888";
export const FINANCE_USER = "99999999-9999-4999-8999-999999999999";
export const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OUTSIDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const WORSHIP_LEADER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const WORSHIP_MEMBER = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
export const HULK_MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const OPS_MEMBER = "dededede-dede-4ded-8ded-dededededede";
export const LEADERSHIP_MEMBER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const LEADERSHIP_ROLE = "efefefef-efef-4efe-8efe-efefefefefef";
export const INACTIVE_ADMIN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const SCOPED_ADMIN = "12121212-1212-4121-8121-121212121212";
export const PENDING_LEADER = "13131313-1313-4131-8131-131313131313";
export const PLAIN_ADMIN = "14141414-1414-4141-8141-141414141414";

export const ROCK_ID = "15151515-1515-4151-8151-151515151515";
export const OTHER_ROCK_ID = "16161616-1616-4161-8161-161616161616";
export const LINK_ID = "17171717-1717-4171-8171-171717171717";
export const OTHER_LINK_ID = "18181818-1818-4181-8181-181818181818";
export const PROJECT_ID = "19191919-1919-4191-8191-191919191919";
export const ORG_ID = "1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
export const CYCLE_ID = "1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b";
export const OLD_CYCLE_ID = "1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c";
export const OBJECTIVE_ID = "1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d";
export const PERSONAL_OBJECTIVE_ID = "1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e";
export const ARCHIVED_OBJECTIVE_ID = "1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f";
export const KR_ID = "20202020-2020-4202-8202-202020202020";
export const LINE_ID = "21212121-2121-4212-8212-212121212121";
export const CLOSED_LINE_ID = "22222222-2222-4222-8222-222222222222";
export const PROGRAM_ID = "23232323-2323-4232-8232-232323232323";

type Row = Record<string, unknown>;

export type DepartmentWorld = {
  people: Row[];
  roles: Row[];
  ministries: Row[];
  memberships: Row[];
  serviceOwners: Row[];
  rocks: Row[];
  budgetLinks: Row[];
  projects: Row[];
  orgs: Row[];
  cycles: Row[];
  objectives: Row[];
  keyResults: Row[];
  reportingLines: Row[];
  errors?: Partial<Record<string, boolean>>;
};

function person(
  id: string,
  first: string,
  last: string,
  extras: { email?: string; job_title?: string | null; is_active?: boolean | null } = {}
): Row {
  return {
    id,
    first_name: first,
    last_name: last,
    preferred_name: null,
    display_name: null,
    email: extras.email ?? `${first}.${last}@example.com`.toLowerCase(),
    job_title: extras.job_title ?? null,
    is_active: extras.is_active === undefined ? true : extras.is_active,
  };
}

function ministry(id: string, slug: string, name: string, sort: number, description: string | null, active = true): Row {
  return {
    id,
    slug,
    name,
    description,
    is_active: active,
    ministry_type: "main",
    sort_order: sort,
  };
}

export function makeDepartmentWorld(): DepartmentWorld {
  const quarter = currentQuarter();
  const world: DepartmentWorld = {
    people: [
      person(LEADER, "Hanno", "Leader", { email: "hanno@example.com", job_title: "Producer" }),
      person(MEMBER, "Amahle", "Member", { email: "amahle@example.com" }),
      person(FINANCE_USER, "Coreen", "Finance"),
      person(ADMIN, "Ada", "Admin"),
      person(OUTSIDER, "Omar", "Outsider"),
      person(WORSHIP_LEADER, "Wian", "Worship"),
      person(WORSHIP_MEMBER, "Wendy", "Singer"),
      person(HULK_MEMBER, "Hugo", "Hulk"),
      person(OPS_MEMBER, "Oscar", "Ops"),
      person(LEADERSHIP_MEMBER, "Lindi", "Lead"),
      person(LEADERSHIP_ROLE, "Rita", "Role"),
      person(INACTIVE_ADMIN, "Ian", "Inactive", { is_active: false }),
      person(SCOPED_ADMIN, "Sam", "Scoped"),
      person(PENDING_LEADER, "Pete", "Pending"),
      person(PLAIN_ADMIN, "Pat", "Plain"),
    ],
    roles: [
      { user_id: ADMIN, name: "super_admin", scope_type: null, scope_id: null },
      { user_id: PLAIN_ADMIN, name: "admin", scope_type: null, scope_id: null },
      { user_id: INACTIVE_ADMIN, name: "super_admin", scope_type: null, scope_id: null },
      { user_id: SCOPED_ADMIN, name: "admin", scope_type: "program", scope_id: PROGRAM_ID },
      { user_id: LEADERSHIP_ROLE, name: "leadership_team", scope_type: null, scope_id: null },
    ],
    ministries: [
      ministry(LEADERSHIP, "leadership_team", "Leadership Team", 10, "The leadership team"),
      ministry(WORSHIP, "prayer_and_worship", "Prayer & Worship", 20, "Prayer and worship"),
      ministry(MEDIA, "media", "Media", 30, "Cameras and stories"),
      ministry(HULK, "hulk", "HULC", 40, "HULC"),
      ministry(OPERATIONS, "operations", "Operations", 50, "Operations"),
      ministry(FINANCE, "finances_legal", "Finances & Legal", 60, "Stewardship"),
      ministry(WOVEN, "woven", "Woven", 70, "Retired", false),
    ],
    memberships: [
      { id: "m-leader", user_id: LEADER, staff_ministry_id: MEDIA, member_role: "leader", is_point_leader: true, status: "active" },
      { id: "m-member", user_id: MEMBER, staff_ministry_id: MEDIA, member_role: "member", is_point_leader: false, status: "active" },
      { id: "m-pending", user_id: PENDING_LEADER, staff_ministry_id: MEDIA, member_role: "leader", is_point_leader: false, status: "pending" },
      { id: "m-finance", user_id: FINANCE_USER, staff_ministry_id: FINANCE, member_role: "member", is_point_leader: false, status: "active" },
      { id: "m-worship-leader", user_id: WORSHIP_LEADER, staff_ministry_id: WORSHIP, member_role: "leader", is_point_leader: true, status: "active" },
      { id: "m-worship-member", user_id: WORSHIP_MEMBER, staff_ministry_id: WORSHIP, member_role: "member", is_point_leader: false, status: "active" },
      { id: "m-hulk", user_id: HULK_MEMBER, staff_ministry_id: HULK, member_role: "member", is_point_leader: false, status: "active" },
      { id: "m-ops", user_id: OPS_MEMBER, staff_ministry_id: OPERATIONS, member_role: "member", is_point_leader: false, status: "active" },
      { id: "m-leadership", user_id: LEADERSHIP_MEMBER, staff_ministry_id: LEADERSHIP, member_role: "member", is_point_leader: false, status: "active" },
    ],
    serviceOwners: seedGrants({
      media: MEDIA,
      hulk: HULK,
      leadership_team: LEADERSHIP,
      prayer_and_worship: WORSHIP,
      operations: OPERATIONS,
    }) as unknown as Row[],
    rocks: [
      {
        id: ROCK_ID,
        staff_ministry_id: MEDIA,
        quarter,
        title: "Finish the recap",
        description: "The year in film",
        owner_user_id: LEADER,
        status: "on_track",
        due_on: "2026-12-01",
        created_by: LEADER,
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
      },
      {
        id: OTHER_ROCK_ID,
        staff_ministry_id: WORSHIP,
        quarter,
        title: "Night set",
        description: null,
        owner_user_id: WORSHIP_LEADER,
        status: "off_track",
        due_on: null,
        created_by: WORSHIP_LEADER,
        created_at: "2026-10-02T00:00:00.000Z",
        updated_at: "2026-10-02T00:00:00.000Z",
      },
    ],
    budgetLinks: [
      {
        id: LINK_ID,
        staff_ministry_id: MEDIA,
        finance_project_id: PROJECT_ID,
        budget_cents: 500000,
        spend_cents: 125000,
        currency: "ZAR",
        notes: "Cameras",
        updated_at: "2026-10-01T00:00:00.000Z",
        updated_by: null,
      },
      {
        id: OTHER_LINK_ID,
        staff_ministry_id: WORSHIP,
        finance_project_id: PROJECT_ID,
        budget_cents: 100,
        spend_cents: 0,
        currency: "ZAR",
        notes: null,
        updated_at: null,
        updated_by: null,
      },
    ],
    projects: [
      { id: PROJECT_ID, name: "Media", org_id: ORG_ID, project_type: "ministry", is_active: true },
    ],
    orgs: [{ id: ORG_ID, key: "npc", name: "FFSA NPC" }],
    cycles: [
      { id: CYCLE_ID, name: "2026", slug: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31", is_current: true },
      { id: OLD_CYCLE_ID, name: "2025", slug: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31", is_current: false },
    ],
    objectives: [
      {
        id: OBJECTIVE_ID,
        cycle_id: CYCLE_ID,
        scope: "ministry",
        staff_ministry_id: MEDIA,
        title: "Tell the story",
        description: "A year of films",
        position: 1,
        timeline: "2026",
        owner_note: null,
        is_archived: false,
      },
      {
        id: PERSONAL_OBJECTIVE_ID,
        cycle_id: CYCLE_ID,
        scope: "individual",
        staff_ministry_id: MEDIA,
        title: "Personal",
        description: null,
        position: 2,
        timeline: null,
        owner_note: null,
        is_archived: false,
      },
      {
        id: ARCHIVED_OBJECTIVE_ID,
        cycle_id: CYCLE_ID,
        scope: "ministry",
        staff_ministry_id: MEDIA,
        title: "Old goal",
        description: null,
        position: 3,
        timeline: null,
        owner_note: null,
        is_archived: true,
      },
      {
        id: "24242424-2424-4242-8242-242424242424",
        cycle_id: OLD_CYCLE_ID,
        scope: "ministry",
        staff_ministry_id: MEDIA,
        title: "Last year",
        description: null,
        position: 1,
        timeline: null,
        owner_note: null,
        is_archived: false,
      },
    ],
    keyResults: [
      {
        id: KR_ID,
        objective_id: OBJECTIVE_ID,
        position: 1,
        label: "KR 1.1",
        description: "Publish 12 films",
        current_status: "in_progress",
        current_value: 4,
        metric_unit: "films",
        metric_start: 0,
        metric_target: 12,
      },
    ],
    reportingLines: [
      {
        id: LINE_ID,
        staff_ministry_id: MEDIA,
        leader_user_id: LEADER,
        kind: "oversees",
        label: "Point",
        starts_on: "2026-01-01",
        ends_on: null,
      },
      {
        id: CLOSED_LINE_ID,
        staff_ministry_id: MEDIA,
        leader_user_id: ADMIN,
        kind: "alongside",
        label: "Former",
        starts_on: "2025-01-01",
        ends_on: "2025-12-31",
      },
    ],
  };
  return world;
}

function rowsFor(world: DepartmentWorld, table: string): Row[] | null {
  switch (table) {
    case "users":
      return world.people;
    case "user_roles":
      return world.roles.map((role) => ({
        user_id: role.user_id,
        scope_type: role.scope_type ?? null,
        scope_id: role.scope_id ?? null,
        roles: { name: role.name },
      }));
    case "staff_ministries":
      return world.ministries;
    case "staff_ministry_members":
      return world.memberships;
    case "service_owners":
      return world.serviceOwners;
    case "rocks":
      return world.rocks;
    case "department_budget_links":
      return world.budgetLinks;
    case "finance_projects":
      return world.projects;
    case "finance_orgs":
      return world.orgs;
    case "okr_cycles":
      return world.cycles;
    case "okr_objectives":
      return world.objectives;
    case "okr_key_results":
      return world.keyResults;
    case "reporting_lines":
      return world.reportingLines;
    default:
      return null;
  }
}

function applyFilters(rows: Row[], query: FakeQuery): Row[] {
  return rows.filter((row) => {
    for (const filter of query.filters) {
      if (filter.op !== "eq" && filter.op !== "in" && filter.op !== "is") continue;
      const column = filter.args[0];
      if (typeof column !== "string") continue;
      if (filter.op === "in") {
        const values = filter.args[1] as unknown[];
        if (!values.includes(row[column])) return false;
      } else if (row[column] !== filter.args[1]) {
        return false;
      }
    }
    return true;
  });
}

export function resolveDepartmentWorld(world: DepartmentWorld, query: FakeQuery): FakeResult {
  if (query.table === "audit_logs") return { data: null };
  if (world.errors?.[query.table]) return { error: { message: `${query.table} down` } };

  const rows = rowsFor(world, query.table);
  if (!rows) return { error: { message: `unexpected table ${query.table}` } };

  if (query.action === "insert") {
    const row: Row = {
      ...(query.payload as Row),
      id: crypto.randomUUID(),
      created_at: "2026-11-10T00:00:00.000Z",
      updated_at: "2026-11-10T00:00:00.000Z",
    };
    rows.push(row);
    return { data: [row] };
  }

  if (query.action === "update") {
    const matches = applyFilters(rows, query);
    for (const match of matches) Object.assign(match, query.payload);
    return { data: matches };
  }

  return { data: applyFilters(rows, query) };
}
