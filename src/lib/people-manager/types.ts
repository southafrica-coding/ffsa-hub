// Table names and the columns the People Manager API reads (migration 421).

export const LEAVE_TABLES = {
  types: "leave_types",
  declaredHolidays: "leave_declared_holidays",
  requests: "leave_requests",
  blockouts: "leave_blockouts",
} as const;

export const LEAVE_REQUEST_COLUMNS =
  "id, department_id, requester_id, leave_type_id, start_date, end_date, start_part, end_part, days_count, days_by_year, notes, covering_user_id, covering_note, status, decided_by, decided_at, decision_note, cancelled_by, cancelled_at, slack_notify, created_at, updated_at";

export const LEAVE_TYPE_COLUMNS = "id, department_id, slug, label, sort_order, is_active, annual_allowance_days";

export const LEAVE_BLOCKOUT_COLUMNS = "id, user_id, department_id, start_date, end_date, reason, created_at, updated_at";

export const PERSON_COLUMNS = "id, first_name, last_name, preferred_name";

/** The 421 named error a lost first-decision race maps to. */
export const LEAVE_ALREADY_DECIDED = "leave_request_already_decided";
