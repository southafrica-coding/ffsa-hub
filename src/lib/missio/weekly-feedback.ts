import "server-only";
import { previewWritesDisabled } from "@/lib/preview-writes";
import { houseSubject, runFormRoutes, type RouteRunResult, type RunDeps } from "@/lib/forms/route-runner";
import { buildFieldsById, fieldKey, isFieldVisible, validateSubmission, type FormSchema } from "@/lib/forms/schema";
import {
  MISSIO_WEEKLY_FEEDBACK_SLUG,
  missioWeeklyFeedbackSchema,
  moodFromConnected,
} from "@/lib/forms/templates/missio-weekly-feedback";
import { meetingDateFor } from "@/lib/missio/feedback";

// ============================================================
// Missio weekly feedback — fill and save (Hub Forms F4)
// ============================================================
// One path for both ways in: the house's link (no login) and a
// signed-in leader opening it from the house page. The caller has
// already decided which house; this file never takes a house from
// the browser.
//
// Saving: the answers go into form_submissions (subject = the house),
// then F3's route runner runs with the house passed in, so the
// write_column routes fill missio_house_feedback (one row per house
// per week; sending again updates it), and the follow-up, Care board
// and Slack routes run under their own rules and flags.
//
// Nothing saves until the form row exists (the seed script), and a
// preview deployment never saves: previews share the prod database.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type Fail = { ok: false; status: number; code: string; error: string; fieldErrors?: Record<string, string> };
const fail = (status: number, code: string, error: string, fieldErrors?: Record<string, string>): Fail => ({
  ok: false,
  status,
  code,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

export type WeeklyHouse = { id: string; org_id: string; number: number; name: string | null; meeting_day: string | null };

export type WeeklyForm = { id: string; name: string; slug: string; schema: FormSchema; department_id: string | null };

export type WeeklyFillView = {
  houseId: string;
  houseNumber: number;
  /** The leaders, from the house's name (the house-names ops script fills it). */
  leaders: string | null;
  /** YYYY-MM-DD: the meeting this feedback is for. */
  meetingDate: string;
  lastAttendance: number | null;
  /** Answers already sent this week, keyed like the form. Empty if none. */
  initial: Record<string, unknown>;
  sentBefore: boolean;
  schema: FormSchema;
  /** False until the form row is seeded and active: the page says so and nothing saves. */
  open: boolean;
};

/**
 * The meeting this week's feedback is for: the house's meeting day on or
 * before today, in Johannesburg. A house with no meeting day set (all 20
 * on 22 Nov 2026) meets on Sunday.
 */
export function feedbackSunday(meetingDay: string | null | undefined, now = new Date()): string {
  return meetingDateFor(meetingDay?.trim() ? meetingDay : "sunday", now);
}

function isSchema(raw: unknown): raw is FormSchema {
  return Boolean(raw && typeof raw === "object" && Array.isArray((raw as FormSchema).steps));
}

/** The seeded weekly feedback form, or null when it is not there or not open. */
export async function loadWeeklyForm(db: Db): Promise<WeeklyForm | null> {
  const { data, error } = await db.from("forms").select("*").eq("slug", MISSIO_WEEKLY_FEEDBACK_SLUG).maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (row.kind !== "missio_weekly_feedback" || row.is_active !== true || !isSchema(row.schema)) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    schema: row.schema,
    department_id: (row.department_id as string | null) ?? null,
  };
}

export async function loadWeeklyHouse(db: Db, houseId: string): Promise<WeeklyHouse | null> {
  const { data, error } = await db
    .from("house_churches")
    .select("id, org_id, number, name, meeting_day")
    .eq("id", houseId)
    .maybeSingle();
  if (error || !data) return null;
  return data as WeeklyHouse;
}

/** Keys the form shows, so a row's columns can prefill it. */
function formKeys(schema: FormSchema): string[] {
  return schema.steps.flatMap((s) => s.fields.map((f) => fieldKey(f)));
}

/** Everything the fill page needs. Reads only; never writes. */
export async function loadWeeklyFillView(db: Db, house: WeeklyHouse, now = new Date()): Promise<WeeklyFillView> {
  const form = await loadWeeklyForm(db);
  const schema = form?.schema ?? missioWeeklyFeedbackSchema();
  const meetingDate = feedbackSunday(house.meeting_day, now);

  const recent = await db
    .from("missio_house_feedback")
    .select("*")
    .eq("house_church_id", house.id)
    .lte("meeting_date", meetingDate)
    .order("meeting_date", { ascending: false })
    .limit(2);
  const rows = (recent.error ? [] : recent.data ?? []) as Record<string, unknown>[];
  const existing = rows.find((r) => String(r.meeting_date) === meetingDate) ?? null;
  const previous = rows.find((r) => String(r.meeting_date) !== meetingDate) ?? null;

  const initial: Record<string, unknown> = {};
  if (existing) {
    for (const key of formKeys(schema)) {
      const v = existing[key];
      if (v != null) initial[key] = v;
    }
  }

  return {
    houseId: house.id,
    houseNumber: house.number,
    leaders: house.name?.trim() || null,
    meetingDate,
    lastAttendance: previous && previous.attendance != null ? Number(previous.attendance) : null,
    initial,
    sentBefore: Boolean(existing),
    schema,
    open: Boolean(form),
  };
}

// ────────────────────────────────────────────────────────────
// Saving
// ────────────────────────────────────────────────────────────

const TEXT_MAX = 2000;
const LIST_MAX = 20;

/**
 * Only the answers to questions the form shows right now. A hidden
 * question (the name, when "Yes, I can share a name" is off) is dropped
 * here, so a name a leader typed and then untucked never leaves this
 * function. Anything else the browser sent (a meeting date, a house)
 * is dropped too.
 */
export function cleanAnswers(schema: FormSchema, raw: unknown): Record<string, unknown> {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const fieldsById = buildFieldsById(schema);
  const out: Record<string, unknown> = {};
  // Visibility depends on other answers, so read them from the input.
  for (const field of fieldsById.values()) {
    if (!isFieldVisible(field, fieldsById, input)) continue;
    const key = fieldKey(field);
    const v = input[key];
    if (v == null || v === "") continue;
    if (typeof v === "string") out[key] = v.trim().slice(0, TEXT_MAX);
    else if (typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, LIST_MAX);
  }
  return out;
}

export type WeeklySaveInput = {
  house: WeeklyHouse;
  /** The M4a link it came through, if any. */
  linkId?: string | null;
  answers: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

export type WeeklySaved = { ok: true; meetingDate: string; routes: RouteRunResult[] };

export async function saveWeeklyFeedback(
  db: Db,
  input: WeeklySaveInput,
  deps: RunDeps = {}
): Promise<WeeklySaved | Fail> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  if (previewWritesDisabled(env)) {
    return fail(403, "preview_writes_disabled", "This preview can’t send feedback. Use the live Hub.");
  }
  const form = await loadWeeklyForm(db);
  if (!form) return fail(503, "not_open", "Weekly feedback isn’t open yet. Your pastor will let you know.");

  const answers = cleanAnswers(form.schema, input.answers);
  const checked = validateSubmission(form.schema, answers, { requireContactField: false });
  if (!checked.valid) return fail(400, "invalid_input", "Check the answers marked below.", checked.errors);

  const { data: submission, error } = await db
    .from("form_submissions")
    .insert({
      form_id: form.id,
      contact_id: null,
      raw_data: answers,
      ip_address: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      dedup_action: "new",
      subject_type: "house",
      subject_id: input.house.id,
    })
    .select("id")
    .single();
  if (error || !submission) {
    console.error("[missio/weekly] submission insert failed", error?.message ?? "no row");
    return fail(500, "server_error", "That didn’t send. Try again in a minute.");
  }

  const meetingDate = feedbackSunday(input.house.meeting_day, now);
  const routes = await runFormRoutes(
    db,
    {
      form: { id: form.id, name: form.name, slug: form.slug, event_id: null, department_id: form.department_id },
      schema: form.schema,
      // The meeting date is the server's, never the browser's.
      data: { ...answers, meeting_date: meetingDate },
      submissionId: (submission as { id: string }).id,
      contactId: null,
      subject: houseSubject(input.house.id),
      rowExtras: { link_id: input.linkId ?? null, mood: moodFromConnected(answers.connected_score) },
    },
    { env, now, slack: deps.slack }
  );

  // The week's row is the point: if it did not land, say so.
  const wrote = routes.some((r) => r.action === "write_column" && r.status === "done");
  if (!wrote) {
    const why = routes.filter((r) => r.action === "write_column").map((r) => r.reason ?? r.status);
    console.error("[missio/weekly] feedback row not written", [...new Set(why)].join(","));
    return fail(500, "server_error", "That didn’t send. Try again in a minute.");
  }
  return { ok: true, meetingDate, routes };
}
