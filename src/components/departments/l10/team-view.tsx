"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createL10Api, l10Pages, L10_MEETING_ALREADY_OPEN, type FailureKind } from "./api";
import {
  formatDay,
  formatDueDay,
  formatHm,
  formatMeasure,
  goalLabel,
  hasTrend,
  isAutoHeadline,
  recapHeadlines,
  runningMeetingOf,
  measureStatus,
  membersAsPeople,
  nameOf,
  nextMeetingStart,
  recapSourceName,
  reportWeek,
  scheduleLabel,
  scoreRows,
  todayIn,
  visibleHeadlines,
} from "./derive";
import { MEETING_MINUTES, SEGMENTS } from "./segments";
import type { L10Headline, L10Rock, L10Team, L10TeamDetail } from "./types";
import { AutoRecapCard, Avatar, BackLink, Checkbox, Empty, Masthead, Notice, SectionBar, TeamNotFound, failureCopy, useNow } from "./ui";
import styles from "./l10.module.css";

type Load = { state: "loading" } | { state: "failed"; kind: FailureKind } | { state: "ready"; detail: L10TeamDetail };

const JUMPS = [
  { id: "rocks", label: "Rocks" },
  { id: "scorecard", label: "Scorecard" },
  { id: "todos", label: "To-dos" },
  { id: "issues", label: "Issues" },
  { id: "headlines", label: "Headlines" },
] as const;

export function rockTag(rock: Pick<L10Rock, "status">) {
  if (rock.status === "off_track") return <span className={styles.tagOff}>Off track</span>;
  if (rock.status === "done") return <span className={styles.tagSolved}>Done</span>;
  return <span className={styles.tagOn}>On track</span>;
}

export function TeamView({ slug, departmentName, teamId }: { slug: string; departmentName: string; teamId: string }) {
  const api = useMemo(() => createL10Api(slug), [slug]);
  const pages = l10Pages(slug);
  const router = useRouter();
  const now = useNow(30_000);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FailureKind | null>(null);
  const [problemCode, setProblemCode] = useState<string | null>(null);
  const [joinMeetingId, setJoinMeetingId] = useState<string | null>(null);
  const [pendingTodo, setPendingTodo] = useState<string | null>(null);
  const [pendingHeadline, setPendingHeadline] = useState<string | null>(null);
  const [siblingTeams, setSiblingTeams] = useState<L10Team[]>([]);

  const refresh = useCallback(async () => {
    const [result, list] = await Promise.all([api.getTeam(teamId), api.listTeams()]);
    if (list.ok) setSiblingTeams(list.data.teams);
    setLoad(result.ok ? { state: "ready", detail: result.data } : { state: "failed", kind: result.kind });
    return result;
  }, [api, teamId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.state !== "ready") {
    if (load.state === "failed" && load.kind === "not_found") {
      return <TeamNotFound href={pages.teams} />;
    }
    return (
      <div className={`${styles.root} ${styles.page}`}>
        <BackLink href={pages.teams}>{departmentName} · L10</BackLink>
        {load.state === "loading" ? <p className={styles.empty}>Loading…</p> : <Notice>{failureCopy(load.kind)}</Notice>}
      </div>
    );
  }

  const { detail } = load;
  const { team } = detail;
  const people = membersAsPeople(detail.members);
  const live = runningMeetingOf(detail);
  const start = nextMeetingStart(team, now);
  const schedule = scheduleLabel(team);
  const week = reportWeek(now, team.meeting_timezone);
  const rows = scoreRows(detail.measurables, detail.measurable_values, week);
  const showTrend = hasTrend(rows);
  const today = todayIn(now, team.meeting_timezone);
  const openTodos = detail.todos.filter((todo) => !todo.done);
  const doneTodos = detail.todos.filter((todo) => todo.done);
  const openIssues = detail.issues
    .filter((issue) => issue.status !== "solved")
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const allHeadlines = visibleHeadlines(detail.headlines).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const recaps = recapHeadlines(detail.headlines).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const headlines = allHeadlines.filter((headline) => !isAutoHeadline(headline)).slice(0, 10);


  function applyHeadline(id: string, headline: L10Headline | undefined, dismissedAt: string | null) {
    setLoad((prev) =>
      prev.state === "ready"
        ? {
            state: "ready",
            detail: {
              ...prev.detail,
              headlines: prev.detail.headlines.map((row) =>
                row.id === id ? { ...row, ...headline, dismissed_at: dismissedAt } : row
              ),
            },
          }
        : prev
    );
  }

  async function dismissHeadline(id: string) {
    setPendingHeadline(id);
    setProblem(null);
    setProblemCode(null);
    const result = await api.dismissHeadline(teamId, id);
    setPendingHeadline(null);
    if (!result.ok) {
      setProblem(result.kind);
      setProblemCode(result.code);
      return;
    }
    applyHeadline(id, result.data.headline, result.data.headline?.dismissed_at ?? new Date().toISOString());
  }

  async function restoreHeadline(id: string) {
    setPendingHeadline(id);
    setProblem(null);
    setProblemCode(null);
    const result = await api.restoreHeadline(teamId, id);
    setPendingHeadline(null);
    if (!result.ok) {
      setProblem(result.kind);
      setProblemCode(result.code);
      return;
    }
    applyHeadline(id, result.data.headline, null);
  }

  async function startOrResume() {
    if (live) {
      router.push(pages.meeting(teamId, live.id));
      return;
    }
    setBusy(true);
    setProblem(null);
    setProblemCode(null);
    setJoinMeetingId(null);
    const result = await api.startMeeting(teamId);
    if (result.ok && result.data?.meeting?.id) {
      router.push(pages.meeting(teamId, result.data.meeting.id));
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setProblem(result.kind);
      setProblemCode(result.code);
      if (result.code === L10_MEETING_ALREADY_OPEN) {
        let openId = result.meetingId;
        if (!openId) {
          const again = await refresh();
          openId = again.ok ? runningMeetingOf(again.data)?.id ?? null : null;
        }
        setJoinMeetingId(openId);
      }
      return;
    }
    setProblem("error");
  }

  async function toggleTodo(id: string, done: boolean) {
    setPendingTodo(id);
    const result = await api.setTodoDone(teamId, id, done);
    setPendingTodo(null);
    if (!result.ok) {
      setProblem(result.kind);
      setProblemCode(result.code);
      return;
    }
    setLoad((prev) =>
      prev.state === "ready"
        ? {
            state: "ready",
            detail: {
              ...prev.detail,
              todos: prev.detail.todos.map((todo) =>
                todo.id === id ? (result.data?.todo ?? { ...todo, done, done_at: done ? new Date().toISOString() : null }) : todo
              ),
            },
          }
        : prev
    );
  }

  const startLabel = live
    ? "Resume meeting →"
    : start != null
      ? `Start meeting · ${formatHm(start, team.meeting_timezone)}`
      : "Start meeting";

  return (
    <div className={`${styles.root} ${styles.page}`}>
      <BackLink href={pages.teams}>All teams</BackLink>
      <Masthead
        title={team.name}
        context={
          <>
            <span>{departmentName} · L10</span>
            {schedule ? <span>{schedule}</span> : null}
          </>
        }
      >
        {people.length > 0 ? (
          <ul className={styles.avatars} aria-label="People on this team">
            {people.map((person) => (
              <li key={person.id}>
                <Avatar name={person.name} />
                <span className="sr-only">{person.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Masthead>

      <div className={styles.startRow}>
        <button type="button" className={live ? styles.btnYellow : styles.btnPrimary} onClick={startOrResume} disabled={busy}>
          {busy ? "Starting…" : startLabel}
        </button>
        <span className={styles.mono}>
          {MEETING_MINUTES} min · {SEGMENTS.length} segments
        </span>
      </div>
      {problem ? <Notice>{failureCopy(problem, problemCode)}</Notice> : null}
      {joinMeetingId ? (
        <p className={styles.joinOpen}>
          <Link href={pages.meeting(teamId, joinMeetingId)} className={styles.btnYellow}>
            Join the open meeting
          </Link>
        </p>
      ) : null}

      <nav className={styles.jump} aria-label="Sections">
        {JUMPS.map((jump) => (
          <a key={jump.id} href={`#${jump.id}`} className={styles.jumpLink}>
            {jump.label}
          </a>
        ))}
      </nav>

      <SectionBar id="rocks" title="Rocks" meta={`${detail.rocks.filter((r) => r.status !== "off_track").length}/${detail.rocks.length} on track`} />
      <ul className={styles.list}>
        {detail.rocks.length === 0 ? <Empty as="li">No rocks this quarter.</Empty> : null}
        {detail.rocks.map((rock) => (
          <li key={rock.id} className={`${styles.row} ${rock.status === "off_track" ? styles.rowOff : ""}`}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{rock.title}</div>
              <div className={styles.rowMeta}>
                {nameOf(rock.owner_user_id, people) ?? "No owner"}
                {rock.due_on ? ` · due ${formatDueDay(rock.due_on)}` : ""}
              </div>
            </div>
            <div className={styles.rowEnd}>{rockTag(rock)}</div>
          </li>
        ))}
      </ul>

      <SectionBar id="scorecard" title="Scorecard" meta={`Week of ${formatDueDay(week)}`} />
      <ul className={styles.list}>
        {rows.length === 0 ? <Empty as="li">No measurables yet.</Empty> : null}
        {rows.map((row) => (
          <li key={row.measurable.id} className={`${styles.row} ${row.status === "off" ? styles.rowOff : ""}`}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{row.measurable.title}</div>
              <div className={styles.rowMeta}>
                {nameOf(row.measurable.owner_id, people) ?? "No owner"} · goal {goalLabel(row.measurable)}
              </div>
              {showTrend ? <Trend row={row} /> : null}
            </div>
            <div className={styles.rowEnd}>
              {row.status === "not_marked" ? (
                <span className={styles.tagQuiet}>Not marked</span>
              ) : (
                <span className={`${styles.value} ${row.status === "off" ? styles.valueOff : ""}`}>
                  {formatMeasure(row.measurable, row.value)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <SectionBar id="todos" title="To-dos" meta={`${openTodos.length} open`} />
      <ul className={styles.list}>
        {detail.todos.length === 0 ? <Empty as="li">No to-dos.</Empty> : null}
        {[...openTodos, ...doneTodos].map((todo) => {
          const overdue = !todo.done && todo.due_on != null && todo.due_on < today;
          return (
            <li key={todo.id} className={`${styles.row} ${todo.done ? styles.rowDone : ""}`}>
              <Checkbox
                checked={todo.done}
                label={todo.done ? `Mark "${todo.title}" not done` : `Mark "${todo.title}" done`}
                disabled={pendingTodo === todo.id}
                onToggle={() => toggleTodo(todo.id, !todo.done)}
              />
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>{todo.title}</div>
                <div className={styles.rowMeta}>
                  {nameOf(todo.owner_id, people) ?? "No owner"}
                  {todo.due_on ? ` · due ${formatDueDay(todo.due_on)}` : ""}
                </div>
              </div>
              {overdue ? (
                <div className={styles.rowEnd}>
                  <span className={styles.tagOff}>Overdue</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <SectionBar id="issues" title="Issues" meta={`${openIssues.length} open`} />
      <ul className={styles.list}>
        {openIssues.length === 0 ? <Empty as="li">No open issues.</Empty> : null}
        {openIssues.map((issue) => (
          <li key={issue.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{issue.title}</div>
              <div className={styles.rowMeta}>
                {nameOf(issue.owner_id, people) ?? "Raised by the team"}
                {issue.status === "discussed" ? " · kept from last week" : ""}
              </div>
            </div>
            {issue.priority != null ? (
              <div className={styles.rowEnd}>
                <span className={styles.tagSolved}>#{issue.priority}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <SectionBar id="headlines" title="Headlines" />
      {recaps.map((headline) => (
        <AutoRecapCard
          key={headline.id}
          headline={headline}
          sourceTeamName={recapSourceName(headline, team, siblingTeams)}
          onDismiss={() => void dismissHeadline(headline.id)}
          onRestore={() => void restoreHeadline(headline.id)}
          pending={pendingHeadline === headline.id}
        />
      ))}
      <ul className={styles.list}>
        {headlines.length === 0 && recaps.length === 0 ? <Empty as="li">No headlines yet.</Empty> : null}
        {headlines.map((headline) => (
          <li key={headline.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowWrap}>{headline.body}</div>
              <div className={styles.rowMeta}>
                {nameOf(headline.author_id, people) ?? "Team"} · {formatDay(Date.parse(headline.created_at), team.meeting_timezone)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Trend({ row }: { row: ReturnType<typeof scoreRows>[number] }) {
  return (
    <div className={styles.trend} aria-label="Last 4 weeks">
      {row.trend.map((value, index) => (
        <span
          key={index}
          className={`${styles.trendCell} ${measureStatus(row.measurable, value) === "off" ? styles.trendOff : ""}`}
        >
          {formatMeasure(row.measurable, value)}
        </span>
      ))}
    </div>
  );
}
