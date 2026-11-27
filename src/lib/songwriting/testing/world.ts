// Test-only: a Songwriting world on the Song Library in-memory database
// (lib/song-library/testing/memory-db, which has row hooks), with 417/424's
// rules modelled for a session client:
//   * read/write on every songwriting table = pw_can_access_songwriting
//     (active P&W member or admin); lead-event delete = author or admin
//   * pw_nations: iso_code ^[A-Z]{2}$ (23514), unique iso_code / slug (23505),
//     no blank or untrimmed languages (23514), delete RESTRICTed by leads,
//     trainings (23503)
//   * trainings: training_date inside year/month (23514
//     pw_songwriting_trainings_date_in_month); delete cascades facilitators
//     and clears leads' source_training_id
//   * leads: created_by stamped (auth.uid()) and locked, last_contact_at
//     derived (42501); delete cascades events
//   * lead events: by stamped, append-only (42501 on update), every insert
//     and delete recomputes the lead's last_contact_at
// Names are made up. No real people, nations or leads.

import { PW_LEAD_EVENT_ACTOR_REQUIRED, PW_LEAD_LAST_CONTACT_DERIVED, PW_SONGWRITING_ACTOR_LOCKED } from "@/lib/departments/db.types";
import { createMemoryDb, type DbErr, type MemoryDb, type Row, type Rls } from "@/lib/song-library/testing/memory-db";

export const PW_ID = "00000000-0000-4000-8000-0000000005a1";
export const PW_SLUG = "prayer_and_worship";
export const GROUNDS_ID = "00000000-0000-4000-8000-0000000005a2";
export const GROUNDS_SLUG = "grounds";

export const MEMBER = "00000000-0000-4000-8000-0000000005b1"; // P&W member
export const MEMBER2 = "00000000-0000-4000-8000-0000000005b2"; // P&W member
export const LEADER = "00000000-0000-4000-8000-0000000005b3"; // P&W leader
export const ADMIN = "00000000-0000-4000-8000-0000000005b4"; // admin, no department
export const OUTSIDER = "00000000-0000-4000-8000-0000000005b5"; // active, Grounds only
export const INACTIVE = "00000000-0000-4000-8000-0000000005b6"; // P&W member, account inactive

export const N_TZ = "00000000-0000-4000-8000-0000000005c1"; // has a training and a lead
export const N_EMPTY = "00000000-0000-4000-8000-0000000005c2"; // nothing uses it
export const N_TRAINED = "00000000-0000-4000-8000-0000000005c3"; // a training only

export const T_MARCH = "00000000-0000-4000-8000-0000000005d1"; // 2026-03, dated 2026-03-14, by MEMBER
export const T_IMPORTED = "00000000-0000-4000-8000-0000000005d2"; // 2019-07, no date, imported

export const L_OPEN = "00000000-0000-4000-8000-0000000005e1"; // by MEMBER, owner LEADER, TZ, from T_MARCH
export const L_GROUP = "00000000-0000-4000-8000-0000000005e2"; // by MEMBER2, unassigned
export const E_FIRST = "00000000-0000-4000-8000-0000000005f1"; // on L_OPEN, by MEMBER

const STAMP = "2026-11-01T08:00:00.000Z";
const user = (id: string, first: string, last: string, active = true) => ({ id, first_name: first, last_name: last, preferred_name: null, email: `${first.toLowerCase()}@example.test`, is_active: active });

export const SW_TABLE_NAMES = ["pw_nations", "pw_songwriting_trainings", "pw_training_facilitators", "pw_songwriting_leads", "pw_songwriting_lead_events"];

function seed(): Record<string, Row[]> {
  return {
    staff_ministries: [
      { id: PW_ID, slug: PW_SLUG, name: "Prayer & Worship" },
      { id: GROUNDS_ID, slug: GROUNDS_SLUG, name: "Grounds" },
    ],
    staff_ministry_members: [
      { staff_ministry_id: PW_ID, user_id: MEMBER, is_leader: false },
      { staff_ministry_id: PW_ID, user_id: MEMBER2, is_leader: false },
      { staff_ministry_id: PW_ID, user_id: LEADER, is_leader: true },
      { staff_ministry_id: PW_ID, user_id: INACTIVE, is_leader: false },
      { staff_ministry_id: GROUNDS_ID, user_id: OUTSIDER, is_leader: true },
    ],
    users: [
      user(MEMBER, "Thandi", "Member"),
      user(MEMBER2, "Pieter", "Second"),
      { ...user(LEADER, "Lerato", "Leader"), preferred_name: "Lera" },
      user(ADMIN, "Ada", "Admin"),
      user(OUTSIDER, "Gus", "Grounds"),
      user(INACTIVE, "Ina", "Gone", false),
    ],
    admins: [{ user_id: ADMIN }],
    pw_nations: [
      { id: N_TZ, name: "Tanzania", slug: "tanzania", continent: "africa", status: "active", notes: null, iso_code: "TZ", languages: ["Swahili", "English"], created_at: STAMP, updated_at: STAMP },
      { id: N_EMPTY, name: "Lesotho", slug: "lesotho", continent: "africa", status: "active", notes: null, iso_code: "LS", languages: [], created_at: STAMP, updated_at: STAMP },
      { id: N_TRAINED, name: "England", slug: "england", continent: "europe", status: "active", notes: null, iso_code: null, languages: ["English"], created_at: STAMP, updated_at: STAMP },
    ],
    pw_songwriting_trainings: [
      {
        id: T_MARCH, year: 2026, month: 3, training_date: "2026-03-14", location_text: "Dodoma", nation_id: N_TZ, audience_label: "Worship leaders",
        people_trained: 40, songs_workshop: 6, songs_post: null, notes: null, languages: ["Swahili"], status: "completed", source: "hub", import_key: null,
        created_by: MEMBER, created_at: STAMP, updated_at: STAMP,
      },
      {
        id: T_IMPORTED, year: 2019, month: 7, training_date: null, location_text: "London", nation_id: N_TRAINED, audience_label: "Youth",
        people_trained: null, songs_workshop: 3, songs_post: 1, notes: null, languages: [], status: "completed", source: "imported", import_key: "2019-07-london-youth",
        created_by: null, created_at: STAMP, updated_at: STAMP,
      },
    ],
    pw_training_facilitators: [
      { id: "00000000-0000-4000-8000-0000000005d9", training_id: T_MARCH, person_id: MEMBER, display_name: "Thandi Member", created_at: STAMP, updated_at: STAMP },
    ],
    pw_songwriting_leads: [
      {
        id: L_OPEN, label: "Dodoma worship team", kind: "group", contact_user_id: null, source_training_id: T_MARCH, nation_id: N_TZ, note: null,
        owner_user_id: LEADER, status: "waiting", last_contact_at: "2026-11-02T09:00:00.000Z", created_by: MEMBER, created_at: STAMP, updated_at: "2026-11-02T09:00:00.000Z",
      },
      {
        id: L_GROUP, label: "Cape Town 100% Choir", kind: "organisation", contact_user_id: null, source_training_id: null, nation_id: null, note: "Met at a conference",
        owner_user_id: null, status: "new", last_contact_at: null, created_by: MEMBER2, created_at: STAMP, updated_at: STAMP,
      },
    ],
    pw_songwriting_lead_events: [{ id: E_FIRST, lead_id: L_OPEN, at: "2026-11-02T09:00:00.000Z", by: MEMBER, note: "Called the pastor", created_at: STAMP, updated_at: STAMP }],
    song_library_songs: [
      { id: "00000000-0000-4000-8000-0000000005aa", title: "Song A", source_training_id: T_MARCH },
      { id: "00000000-0000-4000-8000-0000000005ab", title: "Song B", source_training_id: T_MARCH },
      { id: "00000000-0000-4000-8000-0000000005ac", title: "Song C", source_training_id: null },
    ],
  };
}

export function isAdmin(db: MemoryDb, uid: string | null): boolean {
  return !!uid && db.raw("admins").some((a) => a.user_id === uid);
}

function isActive(db: MemoryDb, uid: string | null): boolean {
  return !!uid && db.raw("users").some((u) => u.id === uid && u.is_active === true);
}

function memberOf(db: MemoryDb, uid: string | null, ministryId: string, leadersOnly: boolean): boolean {
  return isActive(db, uid) && db.raw("staff_ministry_members").some((m) => m.user_id === uid && m.staff_ministry_id === ministryId && (!leadersOnly || m.is_leader === true));
}

/** pw_can_access_songwriting(). */
export function canAccess(db: MemoryDb, uid: string | null): boolean {
  return isActive(db, uid) && (isAdmin(db, uid) || memberOf(db, uid, PW_ID, false));
}

export function swRls(db: MemoryDb): Rls {
  return {
    read: (table, _row, uid) => (SW_TABLE_NAMES.includes(table) ? canAccess(db, uid) : true),
    write: (table, row, uid) => {
      if (!SW_TABLE_NAMES.includes(table)) return false;
      if (!canAccess(db, uid)) return false;
      // 424: events insert (by is stamped = uid) or delete by the author or an admin.
      if (table === "pw_songwriting_lead_events") return isAdmin(db, uid) || row.by === uid;
      return true;
    },
    rpc: (name, args, uid) => {
      if (name === "pw_can_access_songwriting") return canAccess(db, uid);
      if (name === "is_admin") return isAdmin(db, uid);
      if (name === "dept_is_ministry_leader") return memberOf(db, uid, args.p_ministry_id as string, true);
      if (name === "dept_is_ministry_member") return memberOf(db, uid, args.p_ministry_id as string, false);
      return false;
    },
  };
}

const check = (constraint: string): DbErr => ({ code: "23514", message: `new row violates check constraint "${constraint}"` });
const dup = (index: string): DbErr => ({ code: "23505", message: `duplicate key value violates unique constraint "${index}"` });
const noBlanks = (list: unknown) => Array.isArray(list) && list.every((x) => typeof x === "string" && /^\S([\s\S]*\S)?$/.test(x));

let clock = 0;
export const tick = () => new Date(Date.UTC(2026, 10, 27, 6, 0, 0) + ++clock * 1000).toISOString();

export function makeWorld(): MemoryDb {
  const ref = { db: null as unknown as MemoryDb };
  const tbl = (t: string) => ref.db.raw(t);
  const signedIn = (uid: string | null) => uid !== null;

  const recompute = (leadId: unknown) => {
    const lead = tbl("pw_songwriting_leads").find((l) => l.id === leadId);
    if (!lead) return;
    const ats = tbl("pw_songwriting_lead_events").filter((e) => e.lead_id === leadId).map((e) => e.at as string).sort();
    lead.last_contact_at = ats.length ? ats[ats.length - 1] : null;
  };

  ref.db = createMemoryDb(seed(), {
    defaults: {
      pw_nations: { continent: null, status: "active", notes: null, iso_code: null, languages: [] },
      pw_songwriting_trainings: { training_date: null, location_text: null, nation_id: null, audience_label: null, people_trained: null, songs_workshop: null, songs_post: null, notes: null, languages: [], status: "completed", source: "hub", import_key: null, created_by: null },
      pw_training_facilitators: { person_id: null },
      pw_songwriting_leads: { kind: "person", contact_user_id: null, source_training_id: null, nation_id: null, note: null, owner_user_id: null, status: "new", last_contact_at: null, created_by: null },
      pw_songwriting_lead_events: { note: null, by: null },
    },
    hooks: {
      pw_nations: {
        before: (op, row, old) => {
          if (op === "delete") {
            if (tbl("pw_songwriting_leads").some((l) => l.nation_id === row.id) || tbl("pw_songwriting_trainings").some((t) => t.nation_id === row.id)) {
              return { code: "23503", message: 'update or delete on table "pw_nations" violates foreign key constraint' };
            }
            return;
          }
          if (row.iso_code !== null && !/^[A-Z]{2}$/.test(String(row.iso_code))) return check("pw_nations_iso_code_format");
          if (!noBlanks(row.languages)) return check("pw_nations_languages_no_blanks");
          const others = tbl("pw_nations").filter((n) => n !== old);
          if (row.iso_code !== null && others.some((n) => n.iso_code === row.iso_code)) return dup("pw_nations_iso_code_key");
          if (others.some((n) => n.slug === row.slug)) return dup("pw_nations_slug_key");
          row.updated_at = tick();
          if (op === "insert") row.created_at = row.updated_at;
        },
      },
      pw_songwriting_trainings: {
        before: (op, row) => {
          if (op === "delete") return;
          const d = row.training_date as string | null;
          if (d && (Number(d.slice(0, 4)) !== row.year || Number(d.slice(5, 7)) !== row.month)) return check("pw_songwriting_trainings_date_in_month");
          if (!noBlanks(row.languages)) return check("pw_songwriting_trainings_languages_no_blanks");
          if (row.nation_id && !tbl("pw_nations").some((n) => n.id === row.nation_id)) return { code: "23503", message: "nation_id fkey" };
          row.updated_at = tick();
        },
        after: (op, row) => {
          if (op !== "delete") return;
          ref.db.tables.pw_training_facilitators = tbl("pw_training_facilitators").filter((f) => f.training_id !== row.id);
          for (const l of tbl("pw_songwriting_leads")) if (l.source_training_id === row.id) l.source_training_id = null;
        },
      },
      pw_training_facilitators: {
        before: (op, row, old) => {
          if (op === "delete") return;
          if (tbl("pw_training_facilitators").some((f) => f !== old && f.training_id === row.training_id && f.display_name === row.display_name)) {
            return dup("pw_training_facilitators_training_name_key");
          }
        },
      },
      pw_songwriting_leads: {
        before: (op, row, old, ctx) => {
          if (op === "delete") return;
          if (op === "insert") {
            if (signedIn(ctx.uid)) row.created_by = ctx.uid;
            if (row.last_contact_at !== null) return { code: "42501", message: PW_LEAD_LAST_CONTACT_DERIVED };
          } else {
            if (signedIn(ctx.uid) && row.created_by !== old!.created_by) return { code: "42501", message: PW_SONGWRITING_ACTOR_LOCKED };
            if (row.last_contact_at !== old!.last_contact_at) return { code: "42501", message: PW_LEAD_LAST_CONTACT_DERIVED };
          }
          for (const [col, table] of [["nation_id", "pw_nations"], ["source_training_id", "pw_songwriting_trainings"], ["owner_user_id", "users"], ["contact_user_id", "users"]] as const) {
            if (row[col] && !tbl(table).some((r) => r.id === row[col])) return { code: "23503", message: `${col} fkey` };
          }
          row.updated_at = tick();
          if (op === "insert") row.created_at = row.updated_at;
        },
        after: (op, row) => {
          if (op === "delete") ref.db.tables.pw_songwriting_lead_events = tbl("pw_songwriting_lead_events").filter((e) => e.lead_id !== row.id);
        },
      },
      pw_songwriting_lead_events: {
        before: (op, row, _old, ctx) => {
          if (op === "update" && signedIn(ctx.uid)) return { code: "42501", message: PW_SONGWRITING_ACTOR_LOCKED };
          if (op === "insert") {
            if (signedIn(ctx.uid)) row.by = ctx.uid;
            else if (!row.by) return { code: "23514", message: PW_LEAD_EVENT_ACTOR_REQUIRED };
            if (!row.at) row.at = tick();
            if (!tbl("pw_songwriting_leads").some((l) => l.id === row.lead_id)) return { code: "23503", message: "lead_id fkey" };
            row.updated_at = row.created_at;
          }
        },
        after: (_op, row) => recompute(row.lead_id),
      },
    },
  });
  return ref.db;
}

export const sessionClient = (db: MemoryDb, uid: string | null) => db.client({ userId: uid, rls: swRls(db) });
export const serviceClient = (db: MemoryDb) => db.client();
