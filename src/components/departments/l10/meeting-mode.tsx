"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createL10Api, l10Pages, type FailureKind } from "./api";
import { displayName, formatHm, issueFor, membersAsPeople, nextL10Date, rankChanges } from "./derive";
import { buildConfirmSummary, buildEndMeetingPayload, readEndResponse, type Person, type SentView } from "./followup";
import { ConfirmDialog, QuickAddSheet, type QuickKind, type QuickValues, type SubmitOutcome } from "./meeting-sheets";
import { SentBody } from "./meeting-sent";
import {
  ConcludeBody,
  HeadlinesBody,
  IdsBody,
  RocksBody,
  ScorecardBody,
  SegueBody,
  TodosBody,
  type MeetingActions,
  type MeetingCtx,
} from "./meeting-segments";
import {
  addMinute,
  advance,
  allowanceMs,
  formatClock,
  formatRemaining,
  formatTotal,
  isOverTime,
  isPaused,
  meetingElapsedMs,
  pause,
  remainingMs,
  resume,
  segmentElapsedMs,
  segmentState,
  timerFromMeeting,
  type TimerState,
} from "./segment-timer";
import { MEETING_MINUTES, SEGMENT_INFO, SEGMENTS, nextSegment, segmentIndex } from "./segments";
import type { IssuePatch, L10Issue, L10Meeting, L10Segment, L10Team, L10TeamDetail } from "./types";
import { Notice, failureCopy, useNow } from "./ui";
import styles from "./l10.module.css";

type Load =
  | { state: "loading" }
  | { state: "failed"; kind: FailureKind }
  | { state: "ready"; detail: L10TeamDetail; meeting: L10Meeting; attendees: Person[]; teams: L10Team[] };

type Phase = "run" | "confirm" | "sent";

interface SheetState {
  kind: QuickKind;
  initialTitle?: string;
  heading?: string;
  submitLabel?: string;
  defaultOwner?: string | null;
  solving?: L10Issue;
}

const BODIES: Record<L10Segment, (props: { ctx: MeetingCtx }) => ReactNode> = {
  segue: SegueBody,
  scorecard: ScorecardBody,
  rock_review: RocksBody,
  headlines: HeadlinesBody,
  todo_list: TodosBody,
  ids: IdsBody,
  conclude: ConcludeBody,
};

function titleKey(title: string): string {
  return `title:${title.trim().toLowerCase()}`;
}

export function MeetingMode({
  slug,
  teamId,
  meetingId,
  viewerId,
}: {
  slug: string;
  teamId: string;
  meetingId: string;
  viewerId: string | null;
}) {
  const api = useMemo(() => createL10Api(slug), [slug]);
  const pages = l10Pages(slug);
  const now = useNow(500);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [ratings, setRatings] = useState<Record<string, number | null>>({});
  const [phase, setPhase] = useState<Phase>("run");
  const [sent, setSent] = useState<{ view: SentView; endedAt: string | null } | null>(null);
  const [ending, setEnding] = useState(false);
  const [endFailure, setEndFailure] = useState<FailureKind | null>(null);
  const [problem, setProblem] = useState<FailureKind | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [advancing, setAdvancing] = useState(false);
  // A to-do already made for an issue whose "solved" update then failed, so a retry doesn't add it twice.
  const solvedTodo = useRef(new Map<string, string>());

  // Meeting mode covers the Hub shell; the page behind must not scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [team, meeting, list] = await Promise.all([
        api.getTeam(teamId),
        api.getMeeting(teamId, meetingId),
        api.listTeams(),
      ]);
      if (cancelled) return;
      if (!team.ok) return setLoad({ state: "failed", kind: team.kind });
      if (!meeting.ok) return setLoad({ state: "failed", kind: meeting.kind });
      const teams = list.ok ? list.data.teams : [];
      const members = membersAsPeople(team.data.members);
      const listed = meeting.data.attendees ?? [];
      const attendees: Person[] =
        listed.length > 0
          ? listed.map((a) => ({
              id: a.profile_id,
              name: displayName(a.name ?? members.find((m) => m.id === a.profile_id)?.name),
            }))
          : members;
      const initial: Record<string, number | null> = {};
      for (const a of listed) initial[a.profile_id] = a.rating;
      setRatings(initial);
      setTimer(timerFromMeeting(meeting.data.meeting));
      const byId = new Map(team.data.headlines.map((h) => [h.id, h]));
      for (const h of meeting.data.headlines) byId.set(h.id, h);
      const detail = { ...team.data, headlines: [...byId.values()] };
      setLoad({ state: "ready", detail, meeting: meeting.data.meeting, attendees, teams });
      if (meeting.data.meeting.ended_at) {
        // Opened after the end: outcomes aren't known here, so none are claimed.
        setSent({
          view: readEndResponse(
            { already_ended: true },
            {
              meetingId,
              attendees,
              ratings: initial,
              todos: team.data.todos,
              issues: team.data.issues,
            }
          ),
          endedAt: meeting.data.meeting.ended_at,
        });
        setPhase("sent");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, teamId, meetingId]);

  const setDetail = useCallback((update: (detail: L10TeamDetail) => L10TeamDetail) => {
    setLoad((prev) => (prev.state === "ready" ? { ...prev, detail: update(prev.detail) } : prev));
  }, []);

  const refetchTeam = useCallback(async () => {
    const result = await api.getTeam(teamId);
    if (result.ok) setDetail(() => result.data);
  }, [api, teamId, setDetail]);

  const withBusy = useCallback(async <T,>(key: string, work: () => Promise<T>): Promise<T> => {
    setBusy((prev) => new Set(prev).add(key));
    try {
      return await work();
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  if (load.state !== "ready" || !timer) {
    return (
      <div className={`${styles.root} ${styles.overlay}`}>
        <div className={`${styles.mHead} theme-light`}>
          <div className={styles.mTop}>
            <Link href={pages.team(teamId)} className={styles.mExit}>
              ← Team
            </Link>
          </div>
        </div>
        <div className={styles.mBody}>
          {load.state === "failed" ? (
            <Notice>
              {load.kind === "not_found"
                ? "This team or meeting isn't here, or you don't have access to it."
                : failureCopy(load.kind)}
            </Notice>
          ) : (
            <p className={styles.empty}>Loading meeting…</p>
          )}
        </div>
      </div>
    );
  }

  const { detail, meeting, attendees, teams } = load;
  const people = membersAsPeople(detail.members);
  const zone = detail.team.meeting_timezone;
  const viewerOnTeam = viewerId != null && people.some((p) => p.id === viewerId) ? viewerId : null;
  const defaultDue = nextL10Date(detail.team, now);
  const segment = timer.segment;
  const over = isOverTime(timer, now);
  const paused = isPaused(timer);
  const upcoming = nextSegment(segment);

  // ── Actions ─────────────────────────────────────────────────────────

  async function raiseIssue(title: string, ownerId?: string | null): Promise<boolean> {
    if (issueFor(title, detail.issues)) return true;
    return withBusy(titleKey(title), async () => {
      const result = await api.addIssue(teamId, { title: title.trim(), owner_id: ownerId ?? null, source_meeting_id: meetingId });
      if (!result.ok) {
        setProblem(result.kind);
        return false;
      }
      const issue = result.data?.issue;
      if (issue) setDetail((d) => ({ ...d, issues: [...d.issues, issue] }));
      else await refetchTeam();
      return true;
    });
  }

  async function updateIssue(id: string, patch: IssuePatch): Promise<boolean> {
    return withBusy(`issue:${id}`, async () => {
      const result = await api.updateIssue(teamId, id, patch);
      if (!result.ok) {
        setProblem(result.kind);
        return false;
      }
      const updated = result.data?.issue;
      setDetail((d) => ({
        ...d,
        issues: d.issues.map((issue) =>
          issue.id === id
            ? (updated ?? {
                ...issue,
                ...patch,
                solved_at: patch.status === "solved" ? new Date().toISOString() : issue.solved_at,
              })
            : issue
        ),
      }));
      return true;
    });
  }

  const actions: MeetingActions = {
    raiseIssue,
    updateIssue,
    toggleTodo: (id, done) => {
      void withBusy(`todo:${id}`, async () => {
        const result = await api.setTodoDone(teamId, id, done);
        if (!result.ok) return setProblem(result.kind);
        const updated = result.data?.todo;
        setDetail((d) => ({
          ...d,
          todos: d.todos.map((todo) =>
            todo.id === id ? (updated ?? { ...todo, done, done_at: done ? new Date().toISOString() : null }) : todo
          ),
        }));
      });
    },
    rank: (issueId, rank) => {
      void (async () => {
        for (const change of rankChanges(detail.issues, issueId, rank)) {
          if (!(await updateIssue(change.id, { priority: change.priority }))) return;
        }
      })();
    },
    dropIssue: (id) =>
      // 416 has no "dropped" status. Drop means the team decided it isn't an
      // issue at all, so it is deleted: no to-do, and it won't carry over.
      withBusy(`issue:${id}`, async () => {
        const result = await api.deleteIssue(teamId, id);
        if (!result.ok) {
          setProblem(result.kind);
          return false;
        }
        setDetail((d) => ({ ...d, issues: d.issues.filter((issue) => issue.id !== id) }));
        return true;
      }),
    solveIssue: (issue) =>
      setSheet({
        kind: "todo",
        initialTitle: issue.title,
        heading: "Solved → to-do",
        submitLabel: "Solve & add to-do",
        defaultOwner: issue.owner_id ?? viewerOnTeam,
        solving: issue,
      }),
    setRating: (userId, rating) => setRatings((prev) => ({ ...prev, [userId]: rating })),
    requestEnd: () => {
      setEndFailure(null);
      setPhase("confirm");
    },
    dismissHeadline: (id) => {
      void withBusy(`headline:${id}`, async () => {
        const result = await api.dismissHeadline(teamId, id);
        if (!result.ok) return setProblem(result.kind);
        const stamped = result.data.headline?.dismissed_at ?? new Date().toISOString();
        setDetail((d) => ({
          ...d,
          headlines: d.headlines.map((headline) =>
            headline.id === id ? { ...headline, ...result.data.headline, dismissed_at: stamped } : headline
          ),
        }));
      });
    },
    restoreHeadline: (id) => {
      void withBusy(`headline:${id}`, async () => {
        const result = await api.restoreHeadline(teamId, id);
        if (!result.ok) return setProblem(result.kind);
        setDetail((d) => ({
          ...d,
          headlines: d.headlines.map((headline) =>
            headline.id === id ? { ...headline, ...result.data.headline, dismissed_at: null } : headline
          ),
        }));
      });
    },
  };

  async function submitSheet(current: SheetState, values: QuickValues): Promise<SubmitOutcome> {
    if (current.kind === "todo") {
      const issueId = current.solving?.id;
      if (!issueId || !solvedTodo.current.has(issueId)) {
        const result = await api.addTodo(teamId, {
          title: values.title,
          owner_id: values.ownerId,
          due_on: values.dueOn,
          source_meeting_id: meetingId,
        });
        if (!result.ok) return result;
        const todo = result.data?.todo;
        if (todo) setDetail((d) => ({ ...d, todos: [...d.todos, todo] }));
        else await refetchTeam();
        if (issueId) solvedTodo.current.set(issueId, todo?.id ?? "created");
      }
      if (issueId) {
        const ok = await updateIssue(issueId, { status: "solved", resolved_meeting_id: meetingId });
        if (!ok) return { ok: false, kind: "error", fieldErrors: {} };
        solvedTodo.current.delete(issueId);
      }
      return { ok: true };
    }
    if (current.kind === "issue") {
      const result = await api.addIssue(teamId, { title: values.title, owner_id: values.ownerId, source_meeting_id: meetingId });
      if (!result.ok) return result;
      const issue = result.data?.issue;
      if (issue) setDetail((d) => ({ ...d, issues: [...d.issues, issue] }));
      else await refetchTeam();
      return { ok: true };
    }
    const result = await api.addHeadline(teamId, { body: values.title, author_id: values.ownerId, source_meeting_id: meetingId });
    if (!result.ok) return result;
    const headline = result.data?.headline;
    if (headline) setDetail((d) => ({ ...d, headlines: [...d.headlines, headline] }));
    else await refetchTeam();
    return { ok: true };
  }

  async function next() {
    if (!timer) return;
    if (segment === "conclude") {
      actions.requestEnd();
      return;
    }
    if (advancing) return;
    setAdvancing(true);
    setProblem(null);
    const from = segment;
    const result = await api.advance(teamId, meetingId, from);
    setAdvancing(false);
    if (result.ok) {
      const serverMeeting = result.data?.meeting;
      const to = serverMeeting ? timerFromMeeting(serverMeeting).segment : (nextSegment(from) ?? from);
      setTimer((prev) => (prev && prev.segment === from ? advance(prev, Date.now(), to) : prev));
      return;
    }
    if (result.kind === "conflict") {
      // Someone else moved the meeting on: follow the server, keep local +1 mins.
      const fresh = await api.getMeeting(teamId, meetingId);
      if (fresh.ok) {
        const rebuilt = timerFromMeeting(fresh.data.meeting);
        setTimer((prev) => ({ ...rebuilt, extraMs: prev?.extraMs ?? {} }));
        return;
      }
    }
    setProblem(result.kind);
  }

  async function end() {
    setEnding(true);
    setEndFailure(null);
    const payload = buildEndMeetingPayload(attendees.map((person) => ({ user_id: person.id, rating: ratings[person.id] })));
    const result = await api.end(teamId, meetingId, payload);
    setEnding(false);
    if (!result.ok) {
      setEndFailure(result.kind);
      return;
    }
    setSent({
      view: readEndResponse(result.data, { meetingId, attendees, ratings, todos: detail.todos, issues: detail.issues }),
      endedAt: result.data.meeting?.ended_at ?? new Date().toISOString(),
    });
    setPhase("sent");
  }

  // ── Render ──────────────────────────────────────────────────────────

  const ctx: MeetingCtx = {
    meetingId,
    meetingStartedAt: meeting.started_at,
    zone,
    detail,
    teams,
    people,
    attendees,
    ratings,
    now,
    busy,
    actions,
  };
  const Body = BODIES[segment];
  const info = SEGMENT_INFO[segment];
  const endedAt = sent?.endedAt ? Date.parse(sent.endedAt) : null;
  const totalMs = endedAt != null ? Math.max(0, endedAt - Date.parse(meeting.started_at)) : meetingElapsedMs(timer, now);
  const nextLabel = upcoming ? `Next: ${SEGMENT_INFO[upcoming].label} →` : "Next: End →";

  return (
    <div className={`${styles.root} ${styles.overlay}`} role="region" aria-label={`${detail.team.name} L10 meeting`}>
      <header className={`${styles.mHead} theme-light`}>
        <div className={styles.mTop}>
          <Link href={pages.team(teamId)} className={styles.mExit}>
            ← Team
          </Link>
          <span className={styles.mTeam}>{detail.team.name} · L10</span>
          {phase === "sent" ? (
            <span className={styles.mTotal}>
              <span className={styles.mTotalLabel}>Total </span>
              {formatTotal(totalMs)}
            </span>
          ) : (
            <span className={styles.mTotal} aria-label="Meeting time">
              {formatTotal(totalMs)}
              <span className={styles.mTotalLabel}> / {formatTotal(MEETING_MINUTES * 60_000)}</span>
            </span>
          )}
        </div>

        {phase === "sent" ? (
          <div className={styles.timerBlock}>
            <div className="min-w-0">
              <div className={styles.segOf}>{endedAt != null ? `Ended ${formatHm(endedAt, zone)}` : "Ended"}</div>
              <div className={styles.segName}>Meeting ended</div>
            </div>
          </div>
        ) : (
          <>
            <ol className={styles.rail} aria-label="Agenda">
              {SEGMENTS.map((item) => {
                const state = segmentState(timer, item.key, now);
                const cls = [
                  styles.railItem,
                  state === "done" || state === "done-over" ? styles.railDone : "",
                  state === "current" || state === "current-over" ? styles.railCurrent : "",
                  state === "done-over" || state === "current-over" ? styles.railOver : "",
                ].join(" ");
                return (
                  <li key={item.key} className={cls} aria-current={item.key === segment ? "step" : undefined}>
                    {item.short}
                    {state === "done-over" ? (
                      <span className={styles.railOverMark} aria-label=" ran over">
                        +
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <div className={styles.timerBlock}>
              <div className="min-w-0">
                <div className={styles.segOf}>
                  {segmentIndex(segment) + 1} of {SEGMENTS.length} · {Math.round(allowanceMs(timer) / 60_000)} min
                  {paused ? " · paused" : ""}
                </div>
                <div className={styles.segName}>{info.label}</div>
                {over ? <span className={`${styles.overTag} mt-1.5`}>Over time</span> : null}
              </div>
              <div className="flex-none">
                <div className={`${styles.timer} ${over ? styles.timerOver : ""}`} role="timer" aria-live="off">
                  {formatRemaining(remainingMs(timer, now))}
                </div>
                <div className={styles.timerSub}>{formatClock(segmentElapsedMs(timer, now))} elapsed</div>
              </div>
            </div>
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.ctl}
                aria-pressed={paused}
                onClick={() => setTimer((t) => (t ? (isPaused(t) ? resume(t, Date.now()) : pause(t, Date.now())) : t))}
              >
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className={styles.ctl} onClick={() => setTimer((t) => (t ? addMinute(t) : t))}>
                +1 min
              </button>
              <button
                type="button"
                className={over ? styles.go : styles.next}
                onClick={next}
                disabled={advancing}
              >
                {advancing ? "Moving…" : nextLabel}
              </button>
            </div>
          </>
        )}
      </header>

      <div className={styles.mBody}>
        {problem ? <Notice>{failureCopy(problem)}</Notice> : null}
        {phase === "sent" && sent ? (
          <SentBody view={sent.view} teamHref={pages.team(teamId)} teamsHref={pages.teams} />
        ) : (
          <Body key={segment} ctx={ctx} />
        )}
      </div>

      {phase !== "sent" ? (
        <nav className={`${styles.quick} theme-light`} aria-label="Quick add">
          <button type="button" className={styles.quickBtn} onClick={() => setSheet({ kind: "todo" })}>
            + To-do
          </button>
          <button type="button" className={styles.quickBtn} onClick={() => setSheet({ kind: "issue" })}>
            + Issue
          </button>
          <button type="button" className={styles.quickBtn} onClick={() => setSheet({ kind: "headline" })}>
            + Headline
          </button>
        </nav>
      ) : null}

      {sheet ? (
        <QuickAddSheet
          key={`${sheet.kind}-${sheet.solving?.id ?? "new"}`}
          kind={sheet.kind}
          people={people}
          defaultOwner={sheet.defaultOwner !== undefined ? sheet.defaultOwner : viewerOnTeam}
          defaultDue={defaultDue}
          initialTitle={sheet.initialTitle}
          heading={sheet.heading}
          submitLabel={sheet.submitLabel}
          onSubmit={(values) => submitSheet(sheet, values)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {phase === "confirm" ? (
        <ConfirmDialog
          summary={buildConfirmSummary({
            attendees,
            ratings,
            todos: detail.todos,
            issues: detail.issues,
            // Unknown (field not sent) counts as a channel; only an explicit null means none.
            hasRecapChannel: detail.team.slack_channel_id !== null,
          })}
          ending={ending}
          failure={endFailure}
          onBack={() => setPhase("run")}
          onConfirm={end}
        />
      ) : null}
    </div>
  );
}
