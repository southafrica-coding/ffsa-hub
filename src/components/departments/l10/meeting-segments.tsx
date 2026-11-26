"use client";

import { useState, type FormEvent } from "react";
import {
  discussionOrder,
  formatDueDay,
  formatMeasure,
  goalLabel,
  hasTrend,
  idsGroups,
  isAutoHeadline,
  issueFor,
  nameOf,
  recapSourceName,
  reportWeek,
  scoreRows,
  todayIn,
  visibleHeadlines, recapHeadlines,
  type IdsRow,
} from "./derive";
import { averageRating, formatAverage, isValidRating, meetingTotals, type Person } from "./followup";
import { canRateAttendee, type RatingRights } from "./ratings";
import type { IssuePatch, L10Issue, L10Rock, L10Team, L10TeamDetail, L10Todo } from "./types";
import { rockTag, Trend } from "./team-view";
import { AutoRecapCard, Avatar, Checkbox, Empty } from "./ui";
import styles from "./l10.module.css";

export interface MeetingActions {
  /** Create an issue unless an open one with this title exists. */
  raiseIssue: (title: string, ownerId?: string | null) => Promise<boolean>;
  toggleTodo: (id: string, done: boolean) => void;
  updateIssue: (id: string, patch: IssuePatch) => Promise<boolean>;
  rank: (issueId: string, rank: number | null) => void;
  dropIssue: (id: string) => Promise<boolean>;
  solveIssue: (issue: L10Issue) => void;
  setRating: (userId: string, rating: number | null) => void;
  requestEnd: () => void;
  dismissHeadline: (id: string) => void;
  restoreHeadline: (id: string) => void;
}

export interface MeetingCtx {
  meetingId: string;
  meetingStartedAt: string;
  zone: string;
  detail: L10TeamDetail;
  /** Other L10 teams in this department, used to name an auto recap's source. */
  teams: L10Team[];
  people: Person[];
  attendees: Person[];
  ratings: Record<string, number | null>;
  /** Who this viewer may rate (#741: self, or leader / overseer / facilitator for anyone). */
  ratingRights: RatingRights;
  /** recapChannelLabel(team): "Live channel", or null when the team has no recap channel. */
  recapChannel: string | null;
  now: number;
  busy: ReadonlySet<string>;
  actions: MeetingActions;
}

function Intro({ children }: { children: string }) {
  return <p className={styles.mIntro}>{children}</p>;
}

// ── Segue ─────────────────────────────────────────────────────────────

export function SegueBody({ ctx }: { ctx: MeetingCtx }) {
  return (
    <>
      <Intro>One personal and one professional best from the last week. Go round the room.</Intro>
      <ul className={styles.list}>
        {ctx.attendees.map((person) => (
          <li key={person.id} className={styles.row}>
            <Avatar name={person.name} />
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{person.name}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Scorecard ─────────────────────────────────────────────────────────

export function ScorecardBody({ ctx }: { ctx: MeetingCtx }) {
  const week = reportWeek(ctx.now, ctx.zone);
  const rows = scoreRows(ctx.detail.measurables, ctx.detail.measurable_values, week);
  const showTrend = hasTrend(rows);
  return (
    <>
      <Intro>Read each number. Off track? One tap drops it to IDS. No discussion here.</Intro>
      <div className={styles.groupHead}>
        <span>Week of {formatDueDay(week)}</span>
        <span>{rows.filter((row) => row.status === "off").length} off</span>
      </div>
      <ul className={styles.list}>
        {rows.length === 0 ? <Empty as="li">No measurables yet.</Empty> : null}
        {rows.map((row) => {
          const raised = issueFor(row.measurable.title, ctx.detail.issues);
          const key = `title:${row.measurable.title.trim().toLowerCase()}`;
          return (
            <li key={row.measurable.id} className={`${styles.row} ${row.status === "off" ? styles.rowOff : ""}`}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>{row.measurable.title}</div>
                <div className={styles.rowMeta}>
                  {nameOf(row.measurable.owner_id, ctx.people) ?? "No owner"} · goal {goalLabel(row.measurable)}
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
                {row.status === "off" ? (
                  raised ? (
                    <span className={styles.tagSolved}>In IDS</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={ctx.busy.has(key)}
                      onClick={() => ctx.actions.raiseIssue(row.measurable.title, row.measurable.owner_id)}
                    >
                      → Issue
                    </button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── Rocks ─────────────────────────────────────────────────────────────

export function RocksBody({ ctx }: { ctx: MeetingCtx }) {
  const rocks = ctx.detail.rocks;
  const [currentId, setCurrentId] = useState<string | null>(rocks[0]?.id ?? null);
  const current = rocks.find((rock) => rock.id === currentId) ?? null;

  async function dropAndNext(rock: L10Rock) {
    const ok = await ctx.actions.raiseIssue(rock.title, rock.owner_user_id);
    if (!ok) return;
    const index = rocks.findIndex((item) => item.id === rock.id);
    setCurrentId(rocks[index + 1]?.id ?? null);
  }

  return (
    <>
      <Intro>Each owner says on track or off track. Anything to discuss drops to IDS.</Intro>
      <ul className={styles.list}>
        {rocks.length === 0 ? <Empty as="li">No rocks this quarter.</Empty> : null}
        {rocks.map((rock) => {
          const isCurrent = rock.id === current?.id;
          const raised = issueFor(rock.title, ctx.detail.issues);
          return (
            <li key={rock.id} className={isCurrent ? styles.current : `${styles.row} ${rock.status === "off_track" ? styles.rowOff : ""}`}>
              {isCurrent ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={styles.currentLabel}>Now · {nameOf(rock.owner_user_id, ctx.people) ?? "No owner"}</span>
                    {rockTag(rock)}
                  </div>
                  <p className={styles.currentTitle}>{rock.title}</p>
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-1.5">
                    {raised ? (
                      <button type="button" className={styles.btn} onClick={() => dropAndNext(rock)}>
                        In IDS · next →
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        disabled={ctx.busy.has(`title:${rock.title.trim().toLowerCase()}`)}
                        onClick={() => dropAndNext(rock)}
                      >
                        Drop to IDS & next
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setCurrentId(rocks[rocks.findIndex((r) => r.id === rock.id) + 1]?.id ?? null)}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="flex min-h-[44px] w-full min-w-0 items-center gap-2.5 text-left"
                  onClick={() => setCurrentId(rock.id)}
                >
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>{rock.title}</div>
                    <div className={styles.rowMeta}>
                      {nameOf(rock.owner_user_id, ctx.people) ?? "No owner"}
                      {raised ? " · in IDS" : ""}
                    </div>
                  </div>
                  <div className={styles.rowEnd}>{rockTag(rock)}</div>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── Headlines ─────────────────────────────────────────────────────────

export function HeadlinesBody({ ctx }: { ctx: MeetingCtx }) {
  const since = Date.parse(ctx.meetingStartedAt) - 7 * 86_400_000;
  const notes = visibleHeadlines(ctx.detail.headlines)
    .filter((h) => !isAutoHeadline(h))
    .filter((h) => h.source_meeting_id === ctx.meetingId || Date.parse(h.created_at) >= since)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const recaps = recapHeadlines(ctx.detail.headlines).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <>
      <Intro>Good news and FYIs, one line each. Anything needing discussion is an issue.</Intro>
      {recaps.map((headline) => (
        <AutoRecapCard
          key={headline.id}
          headline={headline}
          sourceTeamName={recapSourceName(headline, ctx.detail.team, ctx.teams)}
          onDismiss={() => ctx.actions.dismissHeadline(headline.id)}
          onRestore={() => ctx.actions.restoreHeadline(headline.id)}
          pending={ctx.busy.has(`headline:${headline.id}`)}
        />
      ))}
      <ul className={styles.list}>
        {notes.length === 0 && recaps.length === 0 ? <Empty as="li">No headlines yet. Add one below.</Empty> : null}
        {notes.map((headline) => {
          const name = nameOf(headline.author_id, ctx.people);
          return (
            <li key={headline.id} className={styles.row}>
              {name ? <Avatar name={name} small /> : null}
              <div className={styles.rowMain}>
                <div className={styles.rowWrap}>{headline.body}</div>
                <div className={styles.rowMeta}>{name ?? "Team"}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── To-dos ────────────────────────────────────────────────────────────

function TodoRow({ todo, ctx, today }: { todo: L10Todo; ctx: MeetingCtx; today: string }) {
  const overdue = !todo.done && todo.due_on != null && todo.due_on < today;
  const isNew = todo.source_meeting_id === ctx.meetingId;
  return (
    <li className={`${styles.row} ${todo.done ? styles.rowDone : ""}`}>
      <Checkbox
        checked={todo.done}
        label={todo.done ? `Mark "${todo.title}" not done` : `Mark "${todo.title}" done`}
        disabled={ctx.busy.has(`todo:${todo.id}`)}
        onToggle={() => ctx.actions.toggleTodo(todo.id, !todo.done)}
      />
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>{todo.title}</div>
        <div className={styles.rowMeta}>
          {nameOf(todo.owner_id, ctx.people) ?? "No owner"}
          {todo.due_on ? ` · due ${formatDueDay(todo.due_on)}` : ""}
        </div>
      </div>
      <div className={styles.rowEnd}>
        {isNew ? <span className={styles.tag}>New</span> : null}
        {overdue ? <span className={styles.tagOff}>Overdue</span> : null}
      </div>
    </li>
  );
}

export function TodosBody({ ctx }: { ctx: MeetingCtx }) {
  const today = todayIn(ctx.now, ctx.zone);
  const since = Date.parse(ctx.meetingStartedAt) - 7 * 86_400_000;
  const todos = ctx.detail.todos.filter((todo) => !todo.done || (todo.done_at != null && Date.parse(todo.done_at) >= since));
  const done = todos.filter((todo) => todo.done).length;
  return (
    <>
      <Intro>Done or not done. Anything not done and stuck drops to IDS.</Intro>
      <div className={styles.groupHead}>
        <span>{todos.length} to-dos</span>
        <span>
          {done}/{todos.length} done
        </span>
      </div>
      <ul className={styles.list}>
        {todos.length === 0 ? <Empty as="li">No to-dos. Add one below.</Empty> : null}
        {todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} ctx={ctx} today={today} />
        ))}
      </ul>
    </>
  );
}

// ── IDS ───────────────────────────────────────────────────────────────

function RankButtons({ issue, ctx }: { issue: L10Issue; ctx: MeetingCtx }) {
  return (
    <span className={styles.rank} role="group" aria-label={`Rank "${issue.title}"`}>
      {[1, 2, 3].map((rank) => {
        const on = issue.priority === rank;
        return (
          <button
            key={rank}
            type="button"
            className={on ? styles.rankOn : styles.rankBtn}
            aria-pressed={on}
            disabled={ctx.busy.has(`issue:${issue.id}`)}
            onClick={() => ctx.actions.rank(issue.id, on ? null : rank)}
          >
            {rank}
          </button>
        );
      })}
    </span>
  );
}

function IdsRowView({
  row,
  ctx,
  currentId,
  onPick,
}: {
  row: IdsRow;
  ctx: MeetingCtx;
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  if (row.kind !== "issue") {
    const title = row.kind === "rock" ? row.rock.title : row.todo.title;
    const owner = row.kind === "rock" ? row.rock.owner_user_id : row.todo.owner_id;
    return (
      <li className={`${styles.row} ${styles.rowOff}`}>
        <div className={styles.rowMain}>
          <div className={styles.rowTitle}>{title}</div>
          <div className={styles.rowMeta}>
            {row.kind === "rock" ? "Rock off track" : "To-do not done"} · {nameOf(owner, ctx.people) ?? "No owner"}
          </div>
        </div>
        <div className={styles.rowEnd}>
          <button
            type="button"
            className={styles.btn}
            disabled={ctx.busy.has(`title:${title.trim().toLowerCase()}`)}
            onClick={() => ctx.actions.raiseIssue(title, owner)}
          >
            → Issue
          </button>
        </div>
      </li>
    );
  }
  const { issue } = row;
  if (issue.status === "solved") {
    return (
      <li className={`${styles.row} ${styles.rowDone}`}>
        <div className={styles.rowMain}>
          <div className={styles.rowTitle}>{issue.title}</div>
        </div>
        <div className={styles.rowEnd}>
          <span className={styles.tagSolved}>Solved → to-do</span>
        </div>
      </li>
    );
  }
  if (issue.id === currentId) return null;
  return (
    <li className={styles.row}>
      <button type="button" className="min-h-[44px] min-w-0 flex-1 text-left" onClick={() => onPick(issue.id)}>
        <div className={styles.rowTitle}>{issue.title}</div>
        <div className={styles.rowMeta}>
          {nameOf(issue.owner_id, ctx.people) ?? "Raised by the team"}
          {issue.status === "discussed" ? " · kept" : ""}
        </div>
      </button>
      <div className={styles.rowEnd}>
        <RankButtons issue={issue} ctx={ctx} />
      </div>
    </li>
  );
}

function Group({
  title,
  rows,
  ctx,
  currentId,
  onPick,
}: {
  title: string;
  rows: IdsRow[];
  ctx: MeetingCtx;
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className={styles.groupHead}>
        <span className="min-w-0 truncate">{title}</span>
        <span className="flex-none">{rows.length}</span>
      </h3>
      <ul className={styles.list}>
        {rows.map((row) => (
          <IdsRowView
            key={row.kind === "issue" ? row.issue.id : row.kind === "rock" ? `r-${row.rock.id}` : `t-${row.todo.id}`}
            row={row}
            ctx={ctx}
            currentId={currentId}
            onPick={onPick}
          />
        ))}
      </ul>
    </section>
  );
}

export function IdsBody({ ctx }: { ctx: MeetingCtx }) {
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = idsGroups({
    meetingId: ctx.meetingId,
    meetingStartedAt: ctx.meetingStartedAt,
    issues: ctx.detail.issues,
    rocks: ctx.detail.rocks,
    todos: ctx.detail.todos,
  });
  const order = discussionOrder(groups);
  // Kept issues have been talked through; the next undiscussed one comes up.
  const current =
    order.find((issue) => issue.id === picked) ??
    order.find((issue) => issue.status === "identified") ??
    null;

  async function add(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setAdding(true);
    const ok = await ctx.actions.raiseIssue(title);
    setAdding(false);
    if (ok) setDraft("");
  }

  async function keep(issue: L10Issue) {
    const ok = await ctx.actions.updateIssue(issue.id, { status: "discussed" });
    if (ok) setPicked(null);
  }

  async function drop(issue: L10Issue) {
    const ok = await ctx.actions.dropIssue(issue.id);
    if (ok) setPicked(null);
  }

  const busy = current ? ctx.busy.has(`issue:${current.id}`) : false;
  const total = groups.urgent.length + groups.offTrackRocks.length + groups.incompleteTodos.length + groups.talk.length;

  return (
    <>
      <form className={styles.inlineAdd} onSubmit={add}>
        <label className="sr-only" htmlFor="ids-add">
          New issue
        </label>
        <input
          id="ids-add"
          className={styles.input}
          placeholder="Add an issue…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
        />
        <button type="submit" className={styles.btnPrimary} disabled={adding || !draft.trim()}>
          Add
        </button>
      </form>

      {current ? (
        <div className={styles.current} aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className={styles.currentLabel}>Now discussing</span>
            {current.priority != null ? <span className={styles.tagSolved}>#{current.priority}</span> : null}
          </div>
          <p className={styles.currentTitle}>{current.title}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => ctx.actions.solveIssue(current)}>
              Solved → to-do
            </button>
            <button type="button" className={styles.btn} disabled={busy} onClick={() => keep(current)}>
              Keep
            </button>
            <button type="button" className={styles.btnDanger} disabled={busy} onClick={() => drop(current)}>
              Drop
            </button>
          </div>
        </div>
      ) : total > 0 ? (
        <p className={styles.mIntro}>Every issue has been talked through. Rank the top three or move on.</p>
      ) : null}

      {total === 0 ? <Empty>No issues. Add one above.</Empty> : null}
      <Group title="Urgent and important · this week" rows={groups.urgent} ctx={ctx} currentId={current?.id ?? null} onPick={setPicked} />
      <Group title="Off-track rocks" rows={groups.offTrackRocks} ctx={ctx} currentId={current?.id ?? null} onPick={setPicked} />
      <Group title="Incomplete to-dos" rows={groups.incompleteTodos} ctx={ctx} currentId={current?.id ?? null} onPick={setPicked} />
      <Group title="Not urgent, important · talk through" rows={groups.talk} ctx={ctx} currentId={current?.id ?? null} onPick={setPicked} />
    </>
  );
}

// ── Conclude ──────────────────────────────────────────────────────────

function Stepper({ name, value, onChange }: { name: string; value: number | null; onChange: (v: number | null) => void }) {
  // From "not rated", + starts at 8 (the bar for a good meeting) and − at 7.
  const down = () => onChange(value == null ? 7 : Math.max(1, value - 1));
  const up = () => onChange(value == null ? 8 : Math.min(10, value + 1));
  return (
    <span className={styles.stepper} role="group" aria-label={`Rating for ${name}`}>
      <button type="button" className={styles.stepBtn} onClick={down} aria-label={`Lower ${name}'s rating`} disabled={value === 1}>
        −
      </button>
      <span className={`${styles.stepValue} ${value != null && value < 8 ? styles.stepLow : ""}`} aria-live="polite">
        {value ?? "—"}
      </span>
      <button type="button" className={styles.stepBtn} onClick={up} aria-label={`Raise ${name}'s rating`} disabled={value === 10}>
        +
      </button>
    </span>
  );
}

/** Someone else's rating, for a viewer who may only set their own. */
function ReadOnlyRating({ name, value }: { name: string; value: number | null }) {
  if (!isValidRating(value)) {
    return (
      <span className={styles.tagQuiet} aria-label={`${name} has not rated yet`}>
        Not rated
      </span>
    );
  }
  return (
    <span
      className={`${styles.stepValue} ${value < 8 ? styles.stepLow : ""}`}
      aria-label={`${name}'s rating: ${value}`}
    >
      {value}
    </span>
  );
}

export function ConcludeBody({ ctx }: { ctx: MeetingCtx }) {
  const totals = meetingTotals(ctx.meetingId, ctx.detail.todos, ctx.detail.issues);
  const average = averageRating(ctx.attendees.map((person) => ctx.ratings[person.id]));
  const rated = ctx.attendees.filter((person) => isValidRating(ctx.ratings[person.id])).length;
  return (
    <>
      <div className={styles.recap}>
        <div className={styles.recapCell}>
          <div className={styles.statNum}>{totals.newTodos}</div>
          <div className={styles.statLabel}>New to-dos</div>
        </div>
        <div className={styles.recapCell}>
          <div className={styles.statNum}>{totals.issuesSolved}</div>
          <div className={styles.statLabel}>Issues solved</div>
        </div>
        <div className={styles.recapCell}>
          <div className={styles.statNum}>{totals.issuesKept}</div>
          <div className={styles.statLabel}>Issues kept</div>
        </div>
      </div>

      <div className={styles.groupHead}>
        <span>Rate the meeting · 1–10</span>
        <span>
          {rated}/{ctx.attendees.length}
        </span>
      </div>
      <p className={`${styles.mono} mt-2`}>Not rated yet · anything under 8, say why</p>
      <ul className={styles.list}>
        {ctx.attendees.map((person) => (
          <li key={person.id} className={styles.row}>
            <Avatar name={person.name} />
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{person.name}</div>
              <div className={styles.rowMeta}>{isValidRating(ctx.ratings[person.id]) ? "Rated" : "Not rated yet"}</div>
            </div>
            {canRateAttendee(ctx.ratingRights, person.id) ? (
              <Stepper
                name={person.name}
                value={ctx.ratings[person.id] ?? null}
                onChange={(value) => ctx.actions.setRating(person.id, value)}
              />
            ) : (
              <ReadOnlyRating name={person.name} value={ctx.ratings[person.id] ?? null} />
            )}
          </li>
        ))}
      </ul>
      <div className={styles.average}>
        <span className={styles.mono}>Average{rated > 0 ? ` · ${rated} rated` : ""}</span>
        <span className={styles.sumNum}>{formatAverage(average)}</span>
      </div>

      <button type="button" className={`${styles.btnYellow} ${styles.btnBlock} mt-4 min-h-[52px]`} onClick={ctx.actions.requestEnd}>
        End meeting & send follow-ups
      </button>
      <p className={styles.slackNote}>
        Ending sends each person a Slack DM with their to-dos
        {ctx.recapChannel ? ` and posts the recap to the ${ctx.recapChannel}` : ""}. Kept issues and unfinished to-dos
        carry over to next week by themselves.
      </p>
    </>
  );
}
