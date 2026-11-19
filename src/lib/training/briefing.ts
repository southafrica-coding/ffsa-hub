// ────────────────────────────────────────────────────────────
// Training Monday briefing (redesign 48b, prompt T5) — on Slack for now.
// ────────────────────────────────────────────────────────────
// Every Monday 07:30 SAST each person with Training ties gets a short DM
// with only their things for the week: the same list as their Today
// (src/lib/mobile/training-today.ts), so the briefing and the app never
// disagree. Totals and first names only, never note text. Muting the
// "training" module on /profile stops it. No linked Slack → a push.
//
// A cron has no signed-in user, so this uses the service role and scopes
// every read by hand to what that person's RLS would allow (334/304/145):
//   walking with  → enrollment_staff (active)
//   program staff → their school's students (program_staff)
//   school leader → their school's students + leader items (program_leaders)
// Admins who aren't leaders, staff or walkers get no briefing.
// ────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "@/lib/slack/client";
import { sendPush } from "@/lib/push/send";
import {
  ACTIVE_STATUSES,
  addDays,
  firstName,
  LIST_WINDOW_DAYS,
  saToday,
  weekOf,
  type EnrolmentRow,
  type NameRow,
} from "@/lib/mobile/training";
import {
  buildToday,
  isoWeek,
  mapApplications,
  mapOverdue,
  mapReferences,
  mapUngraded,
  programName,
  type TodayPayload,
} from "@/lib/mobile/training-today";
import { getNames, listCheckins } from "@/services/training";
import {
  listDismissals,
  listGradedArrivals,
  listGrades,
  listOpenCare,
  listOverdueCharges,
  listPendingReferences,
  listUndecidedApplications,
} from "@/services/training-today";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
const MAX_LINES = 6;
const ENROLMENT = "id, user_id, program_id, status, enrolled_at, programs(name, code)";

// ── The message ─────────────────────────────────────────────

export type BriefingMessage = { text: string; blocks: unknown[] };

export function briefingMessage(name: string, today: TodayPayload, site: string = SITE): BriefingMessage {
  const open = today.items.filter((i) => !i.done);
  const head = `Morning ${name} ☀️ *Your week in Training*`;
  if (open.length === 0) {
    const text = `${head}\nAll clear this week 🙌`;
    return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
  }
  const lines = open.slice(0, MAX_LINES).map((i) => `• ${i.title}${i.meta ? ` · ${i.meta}` : ""}`);
  if (open.length > MAX_LINES) lines.push(`• …and ${open.length - MAX_LINES} more`);
  const text = `${head}\n${lines.join("\n")}\nOpen the Training tab in the FFSA Hub app to tick them off.`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${head}\n${lines.join("\n")}` } },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open Training" }, url: `${site}/schools`, style: "primary" }],
      },
      { type: "context", elements: [{ type: "mrkdwn", text: "Or open the *Training* tab in the FFSA Hub app. Mute this on your Hub profile." }] },
    ],
  };
}

// ── Who gets it ─────────────────────────────────────────────

export async function briefingRecipients(admin: Client, today: string): Promise<string[]> {
  const [leaders, staff, walkers] = await Promise.all([
    admin.from("program_leaders").select("user_id"),
    admin.from("program_staff").select("user_id"),
    admin.from("enrollment_staff").select("user_id").or(`ends_on.is.null,ends_on.gt.${today}`),
  ]);
  const ids = new Set<string>();
  for (const r of [leaders, staff, walkers]) for (const row of (r.data ?? []) as Array<{ user_id: string }>) ids.add(row.user_id);
  if (ids.size === 0) return [];
  const { data } = await admin.from("users").select("id, is_active").in("id", [...ids]);
  return ((data ?? []) as Array<{ id: string; is_active: boolean | null }>).filter((u) => u.is_active !== false).map((u) => u.id);
}

// ── One person's week, scoped by hand ───────────────────────

export async function todayForUser(admin: Client, userId: string, now: Date): Promise<TodayPayload> {
  const today = saToday(now);
  const week = weekOf(now);
  const [walked, led, staffOf, dismissals] = await Promise.all([
    admin.from("enrollment_staff").select("enrollment_id").eq("user_id", userId).or(`ends_on.is.null,ends_on.gt.${today}`),
    admin.from("program_leaders").select("program_id").eq("user_id", userId),
    admin.from("program_staff").select("program_id").eq("user_id", userId),
    listDismissals(admin, userId, isoWeek(week)),
  ]);
  const walkedIds = ((walked.data ?? []) as Array<{ enrollment_id: string }>).map((r) => r.enrollment_id);
  const ledIds = ((led.data ?? []) as Array<{ program_id: string }>).map((r) => r.program_id);
  const schoolIds = [...new Set([...ledIds, ...((staffOf.data ?? []) as Array<{ program_id: string }>).map((r) => r.program_id)])];

  const base = () =>
    admin.from("enrollments").select(ENROLMENT).in("status", [...ACTIVE_STATUSES]).is("removed_at", null).neq("user_id", userId);
  const [byWalk, bySchool] = await Promise.all([
    walkedIds.length ? base().in("id", walkedIds) : Promise.resolve({ data: [] }),
    schoolIds.length ? base().in("program_id", schoolIds) : Promise.resolve({ data: [] }),
  ]);
  const rows = new Map<string, EnrolmentRow>();
  for (const r of [...((byWalk.data ?? []) as EnrolmentRow[]), ...((bySchool.data ?? []) as EnrolmentRow[])]) rows.set(r.id, r);
  const students = [...rows.values()];
  const ids = students.map((s) => s.id);
  const manages = new Set(ledIds);
  const managedIds = students.filter((s) => manages.has(s.program_id)).map((s) => s.id);

  const [checkins, care, apps, refs, arrivals, grades, charges] = await Promise.all([
    listCheckins(admin, ids, addDays(today, -LIST_WINDOW_DAYS)),
    ids.length ? listOpenCare(admin, ids) : Promise.resolve({ data: [] }),
    manages.size ? listUndecidedApplications(admin) : Promise.resolve({ data: [] }),
    manages.size ? listPendingReferences(admin) : Promise.resolve({ data: [] }),
    managedIds.length ? listGradedArrivals(admin, managedIds) : Promise.resolve({ data: [] }),
    managedIds.length ? listGrades(admin, managedIds) : Promise.resolve({ data: [] }),
    manages.size ? listOverdueCharges(admin, today) : Promise.resolve({ data: [] }),
  ]);

  const lastWeek = new Map<string, string>();
  for (const c of (checkins.data ?? []) as Array<{ enrollment_id: string; week_of: string }>) {
    const prev = lastWeek.get(c.enrollment_id);
    if (!prev || c.week_of > prev) lastWeek.set(c.enrollment_id, c.week_of);
  }
  const careRows = (care.data ?? []) as Array<{ id: string; enrollment_id: string; by_user_id: string; created_at: string }>;
  const names = await getNames(admin, [...students.map((s) => s.user_id), ...careRows.map((c) => c.by_user_id)]);
  const walkedSet = new Set(walkedIds);

  return buildToday({
    me: userId,
    today,
    weekOf: week,
    manages,
    students: students.map((r) => ({
      enrollmentId: r.id,
      userId: r.user_id,
      programId: r.program_id,
      programName: programName(r.programs),
      status: r.status,
      walkingWithMe: walkedSet.has(r.id),
      lastWeekOf: lastWeek.get(r.id) ?? null,
    })),
    care: careRows.map((c) => ({ checkinId: c.id, enrollmentId: c.enrollment_id, authorId: c.by_user_id, createdAt: c.created_at })),
    applications: mapApplications(apps.data ?? []),
    references: mapReferences(refs.data ?? []),
    ungraded: mapUngraded(arrivals.data ?? [], grades.data ?? [], today),
    overdue: mapOverdue(charges.data ?? []),
    names: new Map(((names.data ?? []) as NameRow[]).map((n) => [n.id, n])),
    dismissed: new Set(((dismissals.data ?? []) as Array<{ item_key: string }>).map((d) => d.item_key)),
  });
}

// ── Send ────────────────────────────────────────────────────

export type BriefingRun = { recipients: number; slack: number; push: number; muted: number; failed: number };

export async function sendTrainingBriefing(
  deps: { admin?: Client; now?: Date; slackClient?: typeof slack; push?: typeof sendPush; build?: typeof todayForUser } = {}
): Promise<BriefingRun> {
  const admin = deps.admin ?? (createAdminClient() as Client);
  const now = deps.now ?? new Date();
  const sl = deps.slackClient ?? slack;
  const push = deps.push ?? sendPush;
  const build = deps.build ?? todayForUser;
  const run: BriefingRun = { recipients: 0, slack: 0, push: 0, muted: 0, failed: 0 };

  const ids = await briefingRecipients(admin, saToday(now));
  run.recipients = ids.length;
  if (ids.length === 0) return run;

  const [people, prefs] = await Promise.all([
    admin.from("users").select("id, first_name, last_name, preferred_name, slack_user_id").in("id", ids),
    admin.from("notification_preferences").select("user_id, muted_modules").in("user_id", ids),
  ]);
  const byId = new Map<string, NameRow & { slack_user_id?: string | null }>(
    ((people.data ?? []) as Array<NameRow & { slack_user_id?: string | null }>).map((p) => [p.id, p])
  );
  const muted = new Set(
    ((prefs.data ?? []) as Array<{ user_id: string; muted_modules: string[] | null }>)
      .filter((p) => (p.muted_modules ?? []).includes("training"))
      .map((p) => p.user_id)
  );
  const slackOn = !!process.env.SLACK_BOT_TOKEN;
  const pushTo: string[] = [];

  for (const id of ids) {
    if (muted.has(id)) {
      run.muted += 1;
      continue;
    }
    try {
      const week = await build(admin, id, now);
      const slackId = byId.get(id)?.slack_user_id;
      if (slackOn && slackId) {
        const open = await sl.openConversation(slackId);
        if (open.ok && open.channel?.id) {
          const posted = await sl.postMessage({ channel: open.channel.id, ...briefingMessage(firstName(byId.get(id)), week) });
          if (posted.ok) {
            run.slack += 1;
            continue;
          }
        }
      }
      // No Slack (or Slack refused): a push, but only when there's something to do.
      if (week.open > 0) pushTo.push(id);
    } catch (err) {
      run.failed += 1;
      console.error("[training/briefing] one person failed", err);
    }
  }

  if (pushTo.length > 0) {
    const res = await push(pushTo, { kind: "training_briefing", key: `training-week:${weekOf(now)}`, href: "/schools" });
    if (!("skipped" in res && res.skipped)) run.push = pushTo.length;
  }
  return run;
}
