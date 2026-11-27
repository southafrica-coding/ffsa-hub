// Response shapes of the People Manager API (/api/departments/[slug]/people-manager),
// read from app/api/departments/[slug]/people-manager/_lib/handlers.ts and
// lib/people-manager/{db.types,usage,days}.ts. The UI never reads the server's
// `error` text; failures are mapped by `code` in ./client.
//
// CONTRACT_GAPS (API on this branch vs the approved v1 mockups):
//   * No write API for leave types or guidelines (no leave_settings, no
//     PATCH). The settings screen is read-only.
//   * Block-outs are whole days (start_date, end_date, reason). The mockup's
//     all day / morning / evening choice has no field.
//   * The leave year is the calendar year (1 January); it isn't a setting.
//   * Status is `declined`, never `denied`.
//   * Public holidays never count as leave; the mockup's "counts as a leave
//     day" copy was wrong.
//   * Away rows (GET /away, also_away, cover_conflicts) carry dates and
//     status only, no leave type, so "annual leave 14–18 Dec" reads
//     "away 14–18 Dec".
//   * There is no member-list endpoint for the cover picker. Leaders and
//     admins pick from GET /usage's people; a member gets only themselves
//     there, so members type their cover's name in covering_note (and get
//     no cover_conflicts check, which needs covering_user_id).
//   * No "Message" action exists for the person view, and no "approve with
//     a note" in the Hub mockups; Approve sends no note.

export type LeaveStatus = "pending" | "approved" | "declined" | "cancelled";
export type DayPart = "full" | "am" | "pm";

export type PmType = {
  id: string;
  department_id?: string | null;
  slug: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  /** Yearly guideline; null = no guideline (still counted). */
  annual_allowance_days: number | null;
  is_override?: boolean;
};

export type PmUsage = {
  leave_type_id: string;
  slug: string;
  label: string;
  guideline: number | null;
  used: number;
  pending: number;
  remaining: number | null;
  over: number | null;
};

export type PmMe = {
  user_id: string;
  is_member: boolean;
  is_leader: boolean;
  is_admin: boolean;
  can_request: boolean;
  can_see_department: boolean;
};

export type PmPerson = { user_id: string; name: string };

export type PmGoesTo = { via: "leader" | "admin"; people: PmPerson[] };

export type PmOverview = {
  department: { id: string; slug: string; name: string };
  me: PmMe;
  year: number;
  today: string;
  types: PmType[];
  usage: PmUsage[];
  goes_to: PmGoesTo;
  pending_to_decide: number;
};

export type PmNamed = { id: string; name: string | null };

export type PmSentTo = { user_id: string; name: string | null; ok: boolean; error: string | null };

export type PmRequest = {
  id: string;
  department_id: string;
  requester_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  start_part: DayPart;
  end_part: DayPart;
  days_count: number;
  days_by_year: Record<string, number>;
  notes: string | null;
  covering_user_id: string | null;
  covering_note: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  type: { id: string; slug: string | null; label: string | null };
  requester: PmNamed;
  covering: PmNamed | null;
  decided_by_person: PmNamed | null;
  sent_to: PmSentTo[];
  can_cancel: boolean;
  can_decide: boolean;
};

export type PmAwayRow = {
  user_id: string;
  source: "leave" | "blockout";
  status: "pending" | "approved" | null;
  start_date: string;
  end_date: string;
  start_part: DayPart;
  end_part: DayPart;
  name: string | null;
};

export type PmHoliday = { day: string; name: string };

export type PmProjection = {
  year: number;
  used: number;
  this_request: number;
  total: number;
  guideline: number | null;
  over: number | null;
  reaches_guideline: boolean;
  line: string;
};

export type PmPreview = {
  days: number;
  by_year: Record<string, number>;
  calendar_days: number;
  weekend_days: string[];
  holidays: PmHoliday[];
  no_working_days: boolean;
  usage: PmProjection[];
  also_away: PmAwayRow[];
  cover_conflicts: PmAwayRow[];
  goes_to: PmGoesTo;
};

export type PmRequestList = { scope: "mine" | "department" | "pending"; year: number | null; requests: PmRequest[] };

export type PmRequestDetail = {
  request: PmRequest;
  usage: { year: number; type: PmUsage | null }[];
  also_away: PmAwayRow[];
};

export type PmUsagePerson = { user_id: string; name: string | null; role: string | null; usage: PmUsage[] };

export type PmUsageResponse = { year: number; types: PmType[]; people: PmUsagePerson[] };

export type PmAwayDay = { day: string; away: number; user_ids: string[]; holiday: string | null };

export type PmAway = {
  from: string;
  to: string;
  rows: PmAwayRow[];
  days: PmAwayDay[];
  holidays: PmHoliday[];
  warn_at: number;
};

export type PmBlockout = {
  id: string;
  user_id: string;
  department_id: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PmCreateBody = {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  start_part?: DayPart;
  end_part?: DayPart;
  notes?: string | null;
  covering_user_id?: string | null;
  covering_note?: string | null;
};

export type PmDecision = "approved" | "declined";
export type PmDecisionBody = { decision: PmDecision; note?: string };
