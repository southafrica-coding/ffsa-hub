// Test-only: a People Manager world on the L10 in-memory database
// (lib/l10/testing/memory-db), with 421's read/write rules and RPCs modelled
// for a session client, and a service-role client that bypasses RLS.
//
// Two departments, neither special: "Prayer & Worship" (two leaders, three
// staff) and "Grounds" (one leader, one staff), plus an admin who is in
// neither and an outsider. Names are made up.

import { createMemoryDb, type MemoryDb, type Row, type Rls } from "@/lib/l10/testing/memory-db";
import { routeApprovers } from "../access";
import { countLeaveDays } from "../days";

export const PW_ID = "00000000-0000-4000-8000-0000000000d1";
export const PW_SLUG = "prayer_and_worship";
export const GROUNDS_ID = "00000000-0000-4000-8000-0000000000d2";
export const GROUNDS_SLUG = "grounds";

export const BEN = "00000000-0000-4000-8000-000000000b01"; // P&W leader
export const MIA = "00000000-0000-4000-8000-000000000b02"; // P&W leader
export const SIPHO = "00000000-0000-4000-8000-000000000b03"; // P&W staff
export const ZOE = "00000000-0000-4000-8000-000000000b04"; // P&W staff
export const NOSLACK = "00000000-0000-4000-8000-000000000b05"; // P&W staff, no Slack id
export const GINA = "00000000-0000-4000-8000-000000000b06"; // Grounds sole leader
export const GUS = "00000000-0000-4000-8000-000000000b07"; // Grounds staff
export const ADA = "00000000-0000-4000-8000-000000000b08"; // admin, no department
export const OUTSIDER = "00000000-0000-4000-8000-000000000b09";

export const T_ANNUAL = "00000000-0000-4000-8000-0000000000a1";
export const T_SICK = "00000000-0000-4000-8000-0000000000a2";
export const T_UNPAID = "00000000-0000-4000-8000-0000000000a3";
/** Grounds overrides sick to 10 days. */
export const T_GROUNDS_SICK = "00000000-0000-4000-8000-0000000000a4";

const user = (id: string, first: string, last: string, slack: string | null) => ({
  id,
  first_name: first,
  last_name: last,
  preferred_name: null,
  slack_user_id: slack,
  is_active: true,
});

let clock = 0;
/** A fresh timestamp per write, like now() in separate transactions. */
export const tick = () => new Date(Date.UTC(2026, 10, 26, 6, 0, 0, 0) + ++clock).toISOString();

/**
 * What 421's insert triggers fill in: the column defaults, created_at /
 * updated_at, and days_count / days_by_year from the dates (holidays
 * included). Runs on each inserted row (memory-db's per-row insert hook).
 */
function fillLike421(db: MemoryDb, table: string, row: Row) {
  if (table === "leave_requests") {
    const declared = (db.tables.leave_declared_holidays ?? []).map((h) => ({ day: String(h.day), name: String(h.name) }));
    const start_part = (row.start_part as never) ?? "full";
    const end_part = (row.end_part as never) ?? "full";
    const c = countLeaveDays({ start: String(row.start_date), end: String(row.end_date), startPart: start_part, endPart: end_part, declared });
    const stamp = tick();
    Object.assign(row, {
      start_part,
      end_part,
      notes: row.notes ?? null,
      covering_user_id: row.covering_user_id ?? null,
      covering_note: row.covering_note ?? null,
      status: "pending",
      decided_by: null,
      decided_at: null,
      decision_note: null,
      cancelled_by: null,
      cancelled_at: null,
      slack_notify: [],
      days_count: c.days,
      days_by_year: c.by_year,
      created_at: stamp,
      updated_at: stamp,
    });
  }
  if (table === "leave_blockouts") {
    const stamp = tick();
    Object.assign(row, { reason: row.reason ?? null, department_id: row.department_id ?? null, created_at: stamp, updated_at: stamp });
  }
}

export function makeWorld(extra: Record<string, Row[]> = {}): MemoryDb {
  const db: MemoryDb = createMemoryDb(
    {
    staff_ministries: [
      { id: PW_ID, slug: PW_SLUG, name: "Prayer & Worship", is_active: true },
      { id: GROUNDS_ID, slug: GROUNDS_SLUG, name: "Grounds", is_active: true },
    ],
    staff_ministry_members: [
      { staff_ministry_id: PW_ID, user_id: BEN, member_role: "leader", status: "active" },
      { staff_ministry_id: PW_ID, user_id: MIA, member_role: "leader", status: "active" },
      { staff_ministry_id: PW_ID, user_id: SIPHO, member_role: "member", status: "active" },
      { staff_ministry_id: PW_ID, user_id: ZOE, member_role: "member", status: "active" },
      { staff_ministry_id: PW_ID, user_id: NOSLACK, member_role: "member", status: "active" },
      { staff_ministry_id: GROUNDS_ID, user_id: GINA, member_role: "leader", status: "active" },
      { staff_ministry_id: GROUNDS_ID, user_id: GUS, member_role: "member", status: "active" },
    ],
    users: [
      user(BEN, "Ben", "Okoro", "U_BEN"),
      user(MIA, "Mia", "Fourie", "U_MIA"),
      user(SIPHO, "Sipho", "Ndlovu", "U_SIPHO"),
      user(ZOE, "Zoe", "Adams", "U_ZOE"),
      user(NOSLACK, "Nolan", "Pike", null),
      user(GINA, "Gina", "Marsh", "U_GINA"),
      user(GUS, "Gus", "Hale", "U_GUS"),
      user(ADA, "Ada", "King", "U_ADA"),
      user(OUTSIDER, "Otto", "Vale", "U_OTTO"),
    ],
    admins: [{ user_id: ADA }],
    leave_types: [
      { id: T_ANNUAL, department_id: null, slug: "annual", label: "Annual leave", sort_order: 10, is_active: true, annual_allowance_days: 15 },
      { id: T_SICK, department_id: null, slug: "sick", label: "Sick leave", sort_order: 20, is_active: true, annual_allowance_days: 5 },
      { id: T_UNPAID, department_id: null, slug: "unpaid", label: "Unpaid leave", sort_order: 60, is_active: true, annual_allowance_days: null },
      { id: T_GROUNDS_SICK, department_id: GROUNDS_ID, slug: "sick", label: "Sick leave", sort_order: 20, is_active: true, annual_allowance_days: 10 },
    ],
    leave_declared_holidays: [],
    leave_requests: [],
    leave_blockouts: [],
    ...extra,
    },
    {
      unique: (table, row) => {
        fillLike421(db, table, row);
        return true;
      },
    }
  );
  return db;
}

const t = (db: MemoryDb, name: string) => (db.tables[name] ??= []);
const memberOf = (db: MemoryDb, uid: string | null, dept: string, leadersOnly = false) =>
  !!uid &&
  t(db, "staff_ministry_members").some(
    (m) => m.user_id === uid && m.staff_ministry_id === dept && m.status === "active" && (!leadersOnly || m.member_role === "leader")
  );
const isAdmin = (db: MemoryDb, uid: string | null) => !!uid && t(db, "admins").some((a) => a.user_id === uid);
const canDecide = (db: MemoryDb, dept: string, requester: string, uid: string | null) =>
  !!uid && uid !== requester && (memberOf(db, uid, dept, true) || isAdmin(db, uid));

function effectiveTypes(db: MemoryDb, dept: string) {
  const all = t(db, "leave_types");
  return all
    .filter((x) => x.department_id === dept || (x.department_id === null && !all.some((o) => o.department_id === dept && o.slug === x.slug)))
    .map((x) => ({ ...x, is_override: x.department_id !== null }));
}

function approvers(db: MemoryDb, requestId: string) {
  const r = t(db, "leave_requests").find((x) => x.id === requestId);
  if (!r) return [];
  const leaders = t(db, "staff_ministry_members")
    .filter((m) => m.staff_ministry_id === r.department_id && m.member_role === "leader" && m.status === "active")
    .map((m) => String(m.user_id));
  return routeApprovers({ requesterId: String(r.requester_id), leaderIds: leaders, adminIds: t(db, "admins").map((a) => String(a.user_id)) });
}

function away(db: MemoryDb, dept: string, from: string, to: string) {
  const people = new Set(t(db, "staff_ministry_members").filter((m) => m.staff_ministry_id === dept && m.status === "active").map((m) => m.user_id));
  return [
    ...t(db, "leave_requests")
      .filter((r) => people.has(r.requester_id) && (r.status === "pending" || r.status === "approved") && String(r.start_date) <= to && String(r.end_date) >= from)
      .map((r) => ({ user_id: r.requester_id, source: "leave", status: r.status, start_date: r.start_date, end_date: r.end_date, start_part: r.start_part, end_part: r.end_part })),
    ...t(db, "leave_blockouts")
      .filter((b) => people.has(b.user_id) && String(b.start_date) <= to && String(b.end_date) >= from)
      .map((b) => ({ user_id: b.user_id, source: "blockout", status: null, start_date: b.start_date, end_date: b.end_date, start_part: "full", end_part: "full" })),
  ];
}

function rpc(db: MemoryDb) {
  return (name: string, args: Record<string, unknown>, uid: string | null): unknown => {
    switch (name) {
      case "dept_is_ministry_leader":
        return memberOf(db, uid, String(args.p_ministry_id), true);
      case "dept_is_ministry_member":
        return memberOf(db, uid, String(args.p_ministry_id));
      case "leave_caller_is_admin":
        return isAdmin(db, uid);
      case "leave_effective_types":
        return effectiveTypes(db, String(args.p_department_id));
      case "leave_department_away":
        return uid && !memberOf(db, uid, String(args.p_department_id)) && !isAdmin(db, uid)
          ? []
          : away(db, String(args.p_department_id), String(args.p_from), String(args.p_to));
      // Service role only in 421.
      case "leave_request_approvers":
        return uid ? null : approvers(db, String(args.p_request_id));
      case "leave_user_can_decide":
        return uid ? null : canDecide(db, String(args.p_department_id), String(args.p_requester_id), String(args.p_user));
      default:
        return null;
    }
  };
}

/** 421's policies for a signed-in user (the guard's status rules are left to the code under test). */
export function leaveRls(db: MemoryDb): Rls {
  return {
    read(table, row, uid) {
      if (table === "leave_requests") {
        return row.requester_id === uid || memberOf(db, uid, String(row.department_id), true) || isAdmin(db, uid);
      }
      if (table === "leave_blockouts") {
        if (row.user_id === uid || isAdmin(db, uid)) return true;
        const depts = t(db, "staff_ministry_members").filter((m) => m.user_id === row.user_id && m.status === "active");
        return depts.some((m) => memberOf(db, uid, String(m.staff_ministry_id), true));
      }
      return true;
    },
    write(table, row, uid) {
      if (table === "leave_requests") {
        if (row.status === "pending" && row.decided_by === undefined) {
          // insert
          return row.requester_id === uid && memberOf(db, uid, String(row.department_id));
        }
        return row.requester_id === uid || canDecide(db, String(row.department_id), String(row.requester_id), uid);
      }
      if (table === "leave_blockouts") return row.user_id === uid;
      if (table === "leave_types" || table === "leave_declared_holidays") return isAdmin(db, uid);
      return true;
    },
    rpc: rpc(db),
  };
}

/** The service role: sees and writes everything, answers the server-only RPCs. */
export function serviceClient(db: MemoryDb) {
  return db.client({ userId: null, rls: { read: () => true, write: () => true, rpc: rpc(db) } });
}

export function sessionClient(db: MemoryDb, userId: string) {
  return db.client({ userId, rls: leaveRls(db) });
}

let n = 0;
/** Seed a request the way 421's insert trigger would store it. */
export function seedRequest(db: MemoryDb, r: Partial<Row> & { requester_id: string; department_id: string; leave_type_id: string; start_date: string; end_date: string }): Row {
  n += 1;
  const count = countLeaveDays({ start: r.start_date, end: r.end_date, startPart: (r.start_part as never) ?? "full", endPart: (r.end_part as never) ?? "full" });
  const row: Row = {
    id: `00000000-0000-4000-8000-${String(900000000000 + n)}`,
    start_part: "full",
    end_part: "full",
    days_count: count.days,
    days_by_year: count.by_year,
    notes: null,
    covering_user_id: null,
    covering_note: null,
    status: "pending",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    cancelled_by: null,
    cancelled_at: null,
    slack_notify: [],
    created_at: "2026-11-01T08:00:00.000Z",
    updated_at: `2026-11-01T08:00:00.${String(n).padStart(3, "0")}Z`,
    ...r,
  };
  t(db, "leave_requests").push(row);
  return row;
}

export const PROD_ENV = { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv;
