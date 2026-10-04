// Who in a school's pipeline is doing which part of it — the numbers behind
// the school's Track tab, plus the one writer every answer goes through.
//
// The pipeline is applications, not enrolments: an accepted student still has
// their application row (and an enrolment hanging off it), and everyone not
// yet accepted only has the application. A track is resolved in order of
// authority — the enrolment's own track (what billing reads), then what the
// applicant picked on the form, then a survey answer not yet copied across.

import { getTrackSegments, type TrackSegment } from "@/lib/schools/track-segments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const PIPELINE_STATUSES = [
  "submitted",
  "waiting_for_references",
  "references_received",
  "interview_scheduled",
  "waitlisted",
  "accepted",
];

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  waiting_for_references: "Awaiting references",
  references_received: "References in",
  interview_scheduled: "Interview set",
  waitlisted: "Waitlisted",
  accepted: "Accepted",
};

export type PipelinePerson = {
  applicationId: string;
  name: string;
  email: string | null;
  status: string;
  accepted: boolean;
  enrollmentId: string | null;
  track: {
    kind: "whole" | "segments" | "unknown";
    codes: string[];
    source: "enrollment" | "application" | "survey" | null;
  };
  survey: {
    state: "not_sent" | "sent" | "answered";
    sentAt: string | null;
    answeredAt: string | null;
    remindedAt: string | null;
  };
};

export type TrackSummary = {
  total: number;
  accepted: number;
  applying: number;
  /** People whose track is known, from any source. */
  confirmed: number;
  whole: number;
  unknown: number;
  /** Emailed, no answer, no track anywhere. */
  awaiting: number;
  /** Not yet emailed and no track anywhere, with a usable address. */
  notEmailed: number;
  /** Everyone expected in each segment: whole-programme people plus those who picked it. */
  bySegment: Array<{ code: string; name: string; expected: number; accepted: number }>;
};

const PLACEHOLDER_EMAIL = /@applicant\.local$/i;

function cleanEmail(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const e = c?.trim();
    if (e && !PLACEHOLDER_EMAIL.test(e)) return e;
  }
  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectIn(
  db: Client,
  table: string,
  columns: string,
  column: string,
  ids: string[]
): Promise<Array<Record<string, any>>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const part of chunk(ids, 150)) {
    const { data } = await db.from(table).select(columns).in(column, part);
    rows.push(...(data ?? []));
  }
  return rows;
}

// reminder_sent_at arrives with migration 226; a deploy can land first, so fall
// back to the pre-226 columns rather than losing every survey.
async function selectSurveys(db: Client, appIds: string[]) {
  const base = "application_response_id, intent, email_sent_at, submitted_at";
  try {
    const rows: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const part of chunk(appIds, 150)) {
      const { data, error } = await db
        .from("ffx_track_intent_surveys")
        .select(`${base}, reminder_sent_at`)
        .in("application_response_id", part);
      if (error) throw error;
      rows.push(...(data ?? []));
    }
    return rows;
  } catch {
    return selectIn(db, "ffx_track_intent_surveys", base, "application_response_id", appIds);
  }
}

export async function loadTrackPipeline(
  admin: Client,
  programId: string
): Promise<{ segments: TrackSegment[]; people: PipelinePerson[] }> {
  const segments = await getTrackSegments(admin, programId, ["active", "upcoming", "completed"]);
  if (segments.length === 0) return { segments, people: [] };

  const codeById = new Map(segments.map((s) => [s.id, s.code]));

  const { data: responses } = await admin
    .from("application_responses")
    .select(
      "id, status, user_id, applicant_email, applicant_info, " +
        "users!application_responses_user_id_fkey(first_name, last_name, email)"
    )
    .eq("program_id", programId)
    .is("removed_at", null)
    .in("status", PIPELINE_STATUSES);

  const apps: Array<Record<string, any>> = responses ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const appIds = apps.map((a) => a.id as string);
  if (appIds.length === 0) return { segments, people: [] };

  const [choices, surveys, enrollmentsRes] = await Promise.all([
    selectIn(admin, "application_segment_choices", "application_response_id, billing_course_id", "application_response_id", appIds),
    selectSurveys(admin, appIds),
    admin
      .from("enrollments")
      .select("id, user_id")
      .eq("program_id", programId)
      .is("removed_at", null),
  ]);

  const enrollments: Array<{ id: string; user_id: string | null }> = enrollmentsRes.data ?? [];
  const enrollmentByUser = new Map<string, string>();
  for (const e of enrollments) if (e.user_id) enrollmentByUser.set(e.user_id, e.id);
  const enrollmentSegs = await selectIn(
    admin,
    "enrollment_segments",
    "enrollment_id, billing_course_id",
    "enrollment_id",
    enrollments.map((e) => e.id)
  );

  const group = <T extends Record<string, any>>(rows: T[], key: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = r[key] as string;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const choicesByApp = group(choices, "application_response_id");
  const segsByEnrollment = group(enrollmentSegs, "enrollment_id");
  const surveyByApp = new Map(surveys.map((s) => [s.application_response_id as string, s]));

  const resolve = (rows: Array<Record<string, any>>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    whole: rows.some((r) => r.billing_course_id === null),
    codes: rows
      .map((r) => (r.billing_course_id ? codeById.get(r.billing_course_id) : undefined))
      .filter((c): c is string => !!c),
  });

  const people: PipelinePerson[] = apps.map((a) => {
    const u = a.users as { first_name: string | null; last_name: string | null; email: string | null } | null;
    const info = (a.applicant_info ?? {}) as { first_name?: string; last_name?: string; email?: string };
    const name =
      `${u?.first_name ?? info.first_name ?? ""} ${u?.last_name ?? info.last_name ?? ""}`.trim() ||
      cleanEmail(u?.email, a.applicant_email, info.email) ||
      "Unknown";
    const enrollmentId = a.user_id ? enrollmentByUser.get(a.user_id) ?? null : null;
    const survey = surveyByApp.get(a.id);

    let kind: PipelinePerson["track"]["kind"] = "unknown";
    let codes: string[] = [];
    let source: PipelinePerson["track"]["source"] = null;

    const enrSegs = enrollmentId ? segsByEnrollment.get(enrollmentId) : undefined;
    const appChoices = choicesByApp.get(a.id);
    const intent = survey?.submitted_at ? (survey.intent as { whole_program?: boolean; segments?: string[] } | null) : null;

    if (enrSegs && enrSegs.length > 0) {
      const r = resolve(enrSegs);
      kind = r.whole ? "whole" : "segments";
      codes = r.codes;
      source = "enrollment";
    } else if (appChoices && appChoices.length > 0) {
      const r = resolve(appChoices);
      kind = r.whole ? "whole" : "segments";
      codes = r.codes;
      source = "application";
    } else if (intent) {
      kind = intent.whole_program ? "whole" : "segments";
      codes = intent.whole_program ? [] : intent.segments ?? [];
      source = "survey";
    }

    return {
      applicationId: a.id,
      name,
      email: cleanEmail(u?.email, a.applicant_email, info.email),
      status: a.status,
      accepted: a.status === "accepted",
      enrollmentId,
      track: { kind, codes, source },
      survey: {
        state: survey?.submitted_at ? "answered" : survey?.email_sent_at ? "sent" : "not_sent",
        sentAt: survey?.email_sent_at ?? null,
        answeredAt: survey?.submitted_at ?? null,
        remindedAt: survey?.reminder_sent_at ?? null,
      },
    };
  });

  // One person, one row: the same human can sit behind two applications
  // (signed in, then public). Keep the furthest along.
  const byKey = new Map<string, PipelinePerson>();
  for (const p of people) {
    const key = p.email?.toLowerCase() ?? p.applicationId;
    const prev = byKey.get(key);
    if (!prev || (p.accepted && !prev.accepted)) byKey.set(key, p);
  }
  const deduped = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { segments, people: deduped };
}

export function summariseTrack(people: PipelinePerson[], segments: TrackSegment[]): TrackSummary {
  const known = people.filter((p) => p.track.kind !== "unknown");
  const unknown = people.filter((p) => p.track.kind === "unknown");
  return {
    total: people.length,
    accepted: people.filter((p) => p.accepted).length,
    applying: people.filter((p) => !p.accepted).length,
    confirmed: known.length,
    whole: known.filter((p) => p.track.kind === "whole").length,
    unknown: unknown.length,
    awaiting: unknown.filter((p) => p.survey.state === "sent").length,
    notEmailed: unknown.filter((p) => p.survey.state === "not_sent" && p.email).length,
    bySegment: segments.map((s) => {
      const inSegment = known.filter((p) => p.track.kind === "whole" || p.track.codes.includes(s.code));
      return {
        code: s.code,
        name: s.name,
        expected: inSegment.length,
        accepted: inSegment.filter((p) => p.accepted).length,
      };
    }),
  };
}

/**
 * The one place a person's track is written after they've told us. Records it
 * on the application, and — when they're already accepted and enrolled — on
 * the enrolment too, so the roster and the by-track counts agree.
 *
 * It deliberately never touches billing. An enrolment that already has a
 * billing plan is left alone: finance owns that track until they change it
 * on the student's billing page, which keeps the two in step.
 */
export async function recordTrackChoice(
  admin: Client,
  input: { applicationId: string; wholeProgram: boolean; courseIds: string[] }
): Promise<{ enrollmentUpdated: boolean }> {
  const rows = input.wholeProgram
    ? [{ application_response_id: input.applicationId, billing_course_id: null }]
    : input.courseIds.map((id) => ({
        application_response_id: input.applicationId,
        billing_course_id: id,
      }));

  await admin.from("application_segment_choices").delete().eq("application_response_id", input.applicationId);
  if (rows.length > 0) await admin.from("application_segment_choices").insert(rows);

  const { data: app } = await admin
    .from("application_responses")
    .select("program_id, user_id, status")
    .eq("id", input.applicationId)
    .maybeSingle();
  if (!app?.user_id || app.status !== "accepted") return { enrollmentUpdated: false };

  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("user_id", app.user_id)
    .eq("program_id", app.program_id)
    .is("removed_at", null)
    .maybeSingle();
  if (!enrollment) return { enrollmentUpdated: false };

  const { count } = await admin
    .from("student_billing_plans")
    .select("id", { count: "exact", head: true })
    .eq("enrollment_id", enrollment.id);
  if ((count ?? 0) > 0) return { enrollmentUpdated: false };

  await admin.from("enrollment_segments").delete().eq("enrollment_id", enrollment.id);
  if (rows.length > 0) {
    await admin.from("enrollment_segments").insert(
      rows.map((r) => ({ enrollment_id: enrollment.id, billing_course_id: r.billing_course_id }))
    );
  }
  return { enrollmentUpdated: true };
}
