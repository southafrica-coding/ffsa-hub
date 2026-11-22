import { previewWritesDisabled } from "@/lib/preview-writes";
import { meetingDateFor } from "@/lib/missio/feedback";
import { upsertContactWithDedup } from "@/services/contact-upsert";
import {
  buildFieldsById,
  fieldKey,
  firedRoutes,
  isContactFieldKey,
  isFieldVisible,
  type FiredRoute,
  type FormRouteAction,
  type FormSchema,
  type FormSubjectType,
} from "./schema";
import { sendRouteSlack, type SlackApi, type SlackReason } from "./route-slack";

// ============================================================
// Route runner (Hub Forms F3)
// ============================================================
// After /f/<slug> saves a form_submissions row, this runs every route
// that fired (schema.ts `firedRoutes`). A route that did not fire does
// nothing. Every action is best effort: nothing here may fail the
// submission, and a missing target is a skip, not an error.
//
// Order: attach, write_column, create_or_update_contact, open_followup,
// care_board, slack. Later actions use what earlier ones made (the
// feedback row, the contact).
//
// Preview deployments share the production database, so on a preview
// nothing runs: every fired route comes back skipped ("preview").
// Slack also needs hubFormsSlackEnabled() (flags.ts), checked in
// route-slack.ts. All writes use the service-role client the submit
// route already holds.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type RouteSubject = { type: FormSubjectType; id: string };

export type RunFormRoutesInput = {
  form: {
    id: string;
    name: string;
    slug: string;
    event_id?: string | null;
    department_id?: string | null;
  };
  schema: FormSchema;
  data: Record<string, unknown>;
  submissionId: string;
  /** The contact the submit route matched or made, if any. */
  contactId: string | null;
  /**
   * What the submission is about, decided by the server (never the
   * browser). A house comes from its per-house link or the signed-in
   * leader's house (F4, lib/missio/weekly-feedback.ts); without one the
   * house routes skip with "no_house".
   */
  subject: RouteSubject | null;
  /**
   * Extra columns for the typed feedback row, set by the server (never
   * the browser): the M4a link it came through, and the mood 339 still
   * requires. Written only when a write_column route writes the row.
   */
  rowExtras?: { link_id?: string | null; mood?: "hard" | "okay" | "good" | "great" };
};

/** A house subject, from its per-house link or a leader's login (F4). */
export function houseSubject(houseId: string): RouteSubject {
  return { type: "house", id: houseId };
}

/**
 * The subject the server can vouch for, from the form's subject_type
 * (migration 390). A house is never taken from the form row: only the
 * weekly feedback path (lib/missio/weekly-feedback.ts) knows it, from
 * the link or the login, and passes houseSubject(). /f/<slug> has
 * neither, so it gets null here and the house routes skip.
 */
export function submissionSubject(
  form: { subject_type?: unknown; event_id?: string | null; department_id?: string | null },
  contactId: string | null
): RouteSubject | null {
  if (form.subject_type === "contact" && contactId) return { type: "contact", id: contactId };
  if (form.subject_type === "department" && form.department_id) return { type: "department", id: form.department_id };
  if (form.subject_type === "event" && form.event_id) return { type: "event", id: form.event_id };
  return null;
}

export type RouteRunStatus = "done" | "skipped" | "failed";

export type RouteRunResult = {
  fieldId: string;
  action: FormRouteAction;
  target: string | null;
  status: RouteRunStatus;
  /** Why it skipped or failed, or a note on what it did. */
  reason?: string;
};

export type RunDeps = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  slack?: SlackApi;
};

/** The yes/no question that says the leader may share a name. */
export const SHARE_NAME_KEY = "share_name";
/** Optional question for the meeting date (YYYY-MM-DD). */
export const MEETING_DATE_KEY = "meeting_date";

// ────────────────────────────────────────────────────────────
// Weekly feedback columns write_column may fill (339 + 390)
// ────────────────────────────────────────────────────────────

type ColumnRule =
  | { kind: "int"; min: number; max: number }
  | { kind: "text"; max: number; oneOf?: readonly string[] }
  | { kind: "list"; maxItems: number; maxLength: number };

const PEOPLE = { kind: "int", min: 0, max: 500 } as const;
const MINISTRY = { kind: "int", min: 0, max: 6 } as const;
const SCORE = { kind: "int", min: 1, max: 5 } as const;
const PICK = { kind: "text", max: 200 } as const;
const LONG = { kind: "text", max: 2000 } as const;
const LIST = { kind: "list", maxItems: 20, maxLength: 120 } as const;

export const HOUSE_FEEDBACK_COLUMNS: Record<string, ColumnRule> = {
  attendance: PEOPLE,
  mood: { kind: "text", max: 10, oneOf: ["hard", "okay", "good", "great"] },
  new_names: LIST,
  prayer: LONG,
  notes: LONG,
  first_time_count: PEOPLE,
  member_count: PEOPLE,
  guest_count: PEOPLE,
  invited_count: PEOPLE,
  saved_count: MINISTRY,
  recommitted_count: MINISTRY,
  prophetic_count: MINISTRY,
  healing_count: MINISTRY,
  deliverance_count: MINISTRY,
  win_type: PICK,
  win_notes: LONG,
  challenge_type: PICK,
  challenge_notes: LONG,
  testimonies: LONG,
  connected_score: SCORE,
  welcome_score: SCORE,
  leader_score: SCORE,
  activities: LIST,
  training_needs: LIST,
};

/** NOT NULL in 339: never cleared when a later send leaves them blank. */
const REQUIRED_FEEDBACK_COLUMNS = new Set(["attendance", "mood"]);

/** The value to store, or undefined when it does not fit the column. */
export function coerceColumnValue(rule: ColumnRule, raw: unknown): unknown {
  if (rule.kind === "int") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.trim()) : NaN;
    return Number.isInteger(n) && n >= rule.min && n <= rule.max ? n : undefined;
  }
  if (rule.kind === "text") {
    const s = Array.isArray(raw) ? raw.map(String).join(", ") : raw == null ? "" : String(raw);
    const text = s.trim();
    if (!text) return null;
    if (rule.oneOf) {
      const pick = text.toLowerCase();
      return rule.oneOf.includes(pick) ? pick : undefined;
    }
    return text.slice(0, rule.max);
  }
  const items = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [raw])
    .map((v) => (v == null ? "" : String(v).trim().slice(0, rule.maxLength)))
    .filter(Boolean);
  return [...new Set(items)].slice(0, rule.maxItems);
}

const NEEDS = ["prayer", "talk", "practical"] as const;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isAnswered(v: unknown): boolean {
  return !(v == null || v === "" || v === false || (Array.isArray(v) && v.length === 0));
}

/**
 * Did the leader say a name may be shared? Only a "Yes" (or a ticked
 * box) on the share_name question counts. A form without that question
 * shares no names.
 */
export function nameShared(schema: FormSchema, data: Record<string, unknown>): boolean {
  const fieldsById = buildFieldsById(schema);
  for (const field of fieldsById.values()) {
    if (fieldKey(field) !== SHARE_NAME_KEY) continue;
    if (!isFieldVisible(field, fieldsById, data)) return false;
    const v = data[SHARE_NAME_KEY];
    return v === true || (typeof v === "string" && v.trim().toLowerCase() === "yes");
  }
  return false;
}

function hasShareQuestion(schema: FormSchema): boolean {
  return schema.steps.some((s) => s.fields.some((f) => fieldKey(f) === SHARE_NAME_KEY));
}

type House = { id: string; org_id: string; number: number; name: string | null; meeting_day: string | null };

export function houseLabel(house: Pick<House, "number" | "name">): string {
  return house.name ? `House ${house.number} · ${house.name}` : `House ${house.number}`;
}

function meetingDate(data: Record<string, unknown>, house: House, now: Date): string {
  const raw = data[MEETING_DATE_KEY];
  if (typeof raw === "string" && ISO_DATE.test(raw.trim())) {
    const d = raw.trim();
    // A date that is not a real day, or is in the future, falls back.
    const parsed = new Date(`${d}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d && d <= meetingDateFor(null, now)) {
      return d;
    }
  }
  return meetingDateFor(house.meeting_day, now);
}

const MOODS = ["hard", "okay", "good", "great"];

/** Only the two extras the server may set, and only well-formed. */
function cleanExtras(extras: RunFormRoutesInput["rowExtras"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (extras?.link_id && UUID_RE.test(extras.link_id)) out.link_id = extras.link_id;
  if (extras?.mood && MOODS.includes(extras.mood)) out.mood = extras.mood;
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const result = (f: FiredRoute, status: RouteRunStatus, reason?: string): RouteRunResult => ({
  fieldId: f.field.id,
  action: f.route.action,
  target: f.route.target?.trim() || null,
  status,
  ...(reason ? { reason } : {}),
});

// ────────────────────────────────────────────────────────────
// The runner
// ────────────────────────────────────────────────────────────

export async function runFormRoutes(
  db: Db,
  input: RunFormRoutesInput,
  deps: RunDeps = {}
): Promise<RouteRunResult[]> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const fired = firedRoutes(input.schema, input.data);
  // A form with Slack routes may still need to rewrite last send's DM
  // when nothing fires this time (see route-slack.ts).
  const hasSlackRoutes = input.schema.steps.some((s) =>
    s.fields.some((f) => (f.routes ?? []).some((r) => r.action === "slack"))
  );
  if (fired.length === 0 && !(hasSlackRoutes && input.subject)) return [];

  const by = (action: FormRouteAction) => fired.filter((f) => f.route.action === action);
  const out: RouteRunResult[] = [];

  // `store`: the answer is already in form_submissions.raw_data.
  for (const f of by("store")) out.push(result(f, "done", "in_raw_data"));

  if (previewWritesDisabled(env)) {
    for (const f of fired) if (f.route.action !== "store") out.push(result(f, "skipped", "preview"));
    return out;
  }

  const house = input.subject?.type === "house" ? await loadHouse(db, input.subject.id) : null;
  let contactId = input.contactId;

  // ── attach ──
  for (const f of by("attach")) {
    out.push(await attach(db, input, f, house, contactId));
  }

  // ── write_column (one upsert for the whole submission) ──
  const columnRoutes = by("write_column");
  let feedbackId: string | null = null;
  if (columnRoutes.length > 0) {
    const written = await writeColumns(db, input, columnRoutes, house, now);
    out.push(...written.results);
    feedbackId = written.feedbackId;
  }

  // ── create_or_update_contact (one upsert for the whole submission) ──
  const contactRoutes = by("create_or_update_contact");
  if (contactRoutes.length > 0) {
    const made = await upsertRouteContact(db, input, contactRoutes);
    out.push(...made.results);
    if (made.contactId) contactId = made.contactId;
  }

  // ── open_followup ──
  for (const f of by("open_followup")) {
    out.push(await openFollowup(db, input, f, house, contactId));
  }

  // ── care_board ──
  const onCare = new Set<string>();
  for (const f of by("care_board")) {
    const r = await careBoard(db, f, house, feedbackId, now);
    if (r.status === "done") onCare.add(f.field.id);
    out.push(r);
  }

  // ── slack ──
  const slackRoutes = by("slack");
  if (slackRoutes.length > 0 || (hasSlackRoutes && house)) {
    const reasons: SlackReason[] = slackRoutes.map((f) => ({
      fired: f,
      // A care need's words stay on the Care board, where its privacy holds.
      hidden: (f.field.routes ?? []).some((r) => r.action === "care_board"),
      onCareBoard: onCare.has(f.field.id),
    }));
    const sent = await sendRouteSlack(
      db,
      {
        form: input.form,
        submissionId: input.submissionId,
        subject: input.subject,
        house,
        // A house's week, so sending again rewrites the same DM.
        periodKey: house ? meetingDate(input.data, house, now) : input.submissionId,
        reasons,
      },
      { env, now, slack: deps.slack }
    );
    out.push(...sent);
  }

  return out;
}

// ────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────

async function loadHouse(db: Db, id: string): Promise<House | null> {
  const { data, error } = await db
    .from("house_churches")
    .select("id, org_id, number, name, meeting_day")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as House;
}

const ATTACH_TARGETS = ["contact", "house", "department", "event"] as const;

async function attach(
  db: Db,
  input: RunFormRoutesInput,
  f: FiredRoute,
  house: House | null,
  contactId: string | null
): Promise<RouteRunResult> {
  const target = (f.route.target?.trim() || input.subject?.type || "") as (typeof ATTACH_TARGETS)[number];
  if (!(ATTACH_TARGETS as readonly string[]).includes(target)) return result(f, "skipped", "no_target");
  const id =
    target === "contact"
      ? contactId
      : target === "house"
      ? house?.id ?? null
      : target === "department"
      ? input.form.department_id ?? null
      : input.form.event_id ?? null;
  if (!id) return result(f, "skipped", `no_${target}`);
  const { error } = await db
    .from("form_submissions")
    .update({ subject_type: target, subject_id: id })
    .eq("id", input.submissionId);
  if (error) return result(f, "failed", error.message);
  return result(f, "done");
}

async function writeColumns(
  db: Db,
  input: RunFormRoutesInput,
  routes: FiredRoute[],
  house: House | null,
  now: Date
): Promise<{ results: RouteRunResult[]; feedbackId: string | null }> {
  // Weekly feedback is the only typed record so far: the subject is the house.
  if (!house) return { results: routes.map((f) => result(f, "skipped", "no_house")), feedbackId: null };

  const results: RouteRunResult[] = [];
  const row: Record<string, unknown> = {};
  const accepted: FiredRoute[] = [];
  for (const f of routes) {
    const column = f.route.target?.trim() ?? "";
    const rule = HOUSE_FEEDBACK_COLUMNS[column];
    if (!rule) {
      results.push(result(f, "skipped", "unknown_column"));
      continue;
    }
    const value = coerceColumnValue(rule, f.value);
    if (value === undefined) {
      results.push(result(f, "skipped", "bad_value"));
      continue;
    }
    row[column] = value;
    accepted.push(f);
  }

  // Sending again replaces the week: an "always" column whose question
  // was left blank this time is cleared, so an old answer cannot linger.
  const fieldsById = buildFieldsById(input.schema);
  for (const field of fieldsById.values()) {
    for (const route of field.routes ?? []) {
      if (route.action !== "write_column" || route.when !== "always") continue;
      const column = route.target?.trim() ?? "";
      if (!HOUSE_FEEDBACK_COLUMNS[column] || column in row || REQUIRED_FEEDBACK_COLUMNS.has(column)) continue;
      const v = isFieldVisible(field, fieldsById, input.data) ? input.data[fieldKey(field)] : undefined;
      if (!isAnswered(v)) row[column] = null;
    }
  }

  if (accepted.length === 0) return { results, feedbackId: null };

  const date = meetingDate(input.data, house, now);
  // Same rule as the M4a link (savePublicFeedback): one row per house per
  // meeting date; sending again the same week updates it.
  const { data, error } = await db
    .from("missio_house_feedback")
    .upsert(
      {
        // A real answer (a mood question) wins over the derived extra.
        ...cleanExtras(input.rowExtras),
        ...row,
        house_church_id: house.id,
        meeting_date: date,
        form_submission_id: input.submissionId,
        submitted_at: now.toISOString(),
      },
      { onConflict: "house_church_id,meeting_date" }
    )
    .select("id")
    .single();
  if (error || !data) {
    const reason = error?.message ?? "no_row";
    console.error("[forms/routes] feedback write failed", reason);
    for (const f of accepted) results.push(result(f, "failed", reason));
    return { results, feedbackId: null };
  }
  for (const f of accepted) results.push(result(f, "done"));
  return { results, feedbackId: (data as { id: string }).id };
}

async function upsertRouteContact(
  db: Db,
  input: RunFormRoutesInput,
  routes: FiredRoute[]
): Promise<{ results: RouteRunResult[]; contactId: string | null }> {
  // On a form that asks, a name is only passed on when the leader said yes.
  if (hasShareQuestion(input.schema) && !nameShared(input.schema, input.data)) {
    return { results: routes.map((f) => result(f, "skipped", "not_shared")), contactId: null };
  }
  const contact: Record<string, unknown> = {};
  const accepted: FiredRoute[] = [];
  const results: RouteRunResult[] = [];
  for (const f of routes) {
    const column = f.route.target?.trim() ?? "";
    if (!isContactFieldKey(column)) {
      results.push(result(f, "skipped", "unknown_column"));
      continue;
    }
    const v = Array.isArray(f.value) ? f.value.join(", ") : String(f.value).trim();
    if (!v) continue;
    contact[column] = v.slice(0, 200);
    accepted.push(f);
  }
  if (accepted.length === 0) return { results, contactId: null };
  if (!contact.email && !contact.phone) {
    for (const f of accepted) results.push(result(f, "skipped", "no_email_or_phone"));
    return { results, contactId: null };
  }

  const upsert = await upsertContactWithDedup(db, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contact: contact as any,
    labelId: null,
    addedVia: `form:${input.form.id}`,
    userId: null,
    source: `form:${input.form.slug}`,
    reviewSource: { type: "form", id: input.form.id },
  });
  if (upsert.error || !upsert.data) {
    const reason = (upsert.error as { message?: string } | null)?.message ?? "contact_failed";
    for (const f of accepted) results.push(result(f, "failed", reason));
    return { results, contactId: null };
  }
  if (upsert.data.action === "queued_for_review") {
    for (const f of accepted) results.push(result(f, "done", "queued_for_review"));
    return { results, contactId: null };
  }
  for (const f of accepted) results.push(result(f, "done", upsert.data.action));
  return { results, contactId: upsert.data.contactId };
}

async function missioOrgId(db: Db, house: House | null): Promise<string | null> {
  if (house) return house.org_id;
  const { data } = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function openFollowup(
  db: Db,
  input: RunFormRoutesInput,
  f: FiredRoute,
  house: House | null,
  contactId: string | null
): Promise<RouteRunResult> {
  // Only with a name the leader is willing to share.
  if (!nameShared(input.schema, input.data)) return result(f, "skipped", "not_shared");
  if (!contactId) return result(f, "skipped", "no_contact");
  const orgId = await missioOrgId(db, house);
  if (!orgId) return result(f, "skipped", "no_org");

  // org_people first, then the follow-up (follow-up.ts does the same).
  const person = await db
    .from("org_people")
    .upsert({ org_id: orgId, contact_id: contactId, status: "visitor" }, { onConflict: "org_id,contact_id", ignoreDuplicates: true });
  if (person.error) return result(f, "failed", person.error.message);

  const opened = await db.from("missio_followups").insert({ org_id: orgId, contact_id: contactId, stage: "new" });
  if (opened.error) {
    // One open follow-up per contact (332): already open is fine.
    if (opened.error.code === "23505") return result(f, "done", "already_open");
    return result(f, "failed", opened.error.message);
  }
  return result(f, "done");
}

async function careBoard(
  db: Db,
  f: FiredRoute,
  house: House | null,
  feedbackId: string | null,
  now: Date
): Promise<RouteRunResult> {
  if (!house) return result(f, "skipped", "no_house");
  // The card points at the week's feedback row, exactly as the board's own
  // pull does (care.ts pullSources), so the two can never both add it.
  if (!feedbackId) return result(f, "skipped", "no_feedback_row");
  const body = (Array.isArray(f.value) ? f.value.join(", ") : String(f.value)).trim().slice(0, 2000);
  if (!body) return result(f, "skipped", "empty");
  const target = f.route.target?.trim() ?? "";
  const needs = (NEEDS as readonly string[]).includes(target) ? [target] : ["prayer"];

  const inserted = await db.from("missio_care_requests").insert({
    org_id: house.org_id,
    source: "house_feedback",
    source_id: feedbackId,
    house_church_id: house.id,
    needs,
    body,
    // Pastors only. Nothing here may widen who reads a care need (#684).
    privacy: "pastors",
    created_at: now.toISOString(),
  });
  if (!inserted.error) return result(f, "done");
  if (inserted.error.code !== "23505") return result(f, "failed", inserted.error.message);

  // Sent again the same week: refresh the words while nobody has taken it.
  const updated = await db
    .from("missio_care_requests")
    .update({ body, needs })
    .eq("source", "house_feedback")
    .eq("source_id", feedbackId)
    .eq("status", "new");
  if (updated.error) return result(f, "failed", updated.error.message);
  return result(f, "done", "updated");
}
