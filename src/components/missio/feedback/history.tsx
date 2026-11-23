"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { isMissioPastor } from "../access";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { houseTitle, meetingDayLabel } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { HouseStatus } from "../house-churches/status";
import type { FeedbackEntry, FeedbackHouse, FeedbackMood } from "../house-churches/types";
import ui from "../house-churches/ui.module.css";
import { useMissioViewer } from "../viewer";
import styles from "./history.module.css";

export const MOOD_LABEL: Record<FeedbackMood, string> = { hard: "Hard", okay: "Okay", good: "Good", great: "Great" };

const shortDate = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
const dayName = new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: "UTC" });

/** Board M4b's range switch. A year is 52 weeks, the most the route returns. */
export const FEEDBACK_RANGES = [
  { weeks: 4, label: "4 weeks", span: "4 weeks" },
  { weeks: 12, label: "12 weeks", span: "12 weeks" },
  { weeks: 52, label: "Year", span: "the last year" },
] as const;

export type FeedbackWeeks = (typeof FEEDBACK_RANGES)[number]["weeks"];

function spanOf(weeks: number): string {
  return FEEDBACK_RANGES.find((range) => range.weeks === weeks)?.span ?? `${weeks} weeks`;
}

export function feedbackDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : shortDate.format(date);
}

function weekStarts(weeks: number, now = new Date()): string[] {
  // Monday-start weeks, oldest first, ending with this week.
  const today = new Date(`${now.toISOString().slice(0, 10)}T12:00:00Z`);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() - (weeks - 1 - index) * 7);
    return date.toISOString().slice(0, 10);
  });
}

function weekOf(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * One bar per week (board M4b tiles): reported weeks in stone, the newest
 * report in olive. A missed week is a gap, never a zero.
 */
export function FeedbackBars({ entries, weeks = 12, now }: { entries: FeedbackEntry[]; weeks?: number; now?: Date }) {
  const starts = weekStarts(weeks, now);
  const byWeek = new Map(entries.map((entry) => [weekOf(entry.meetingDate), entry]));
  const max = Math.max(24, ...entries.map((entry) => entry.attendance));
  const reported = starts.filter((start) => byWeek.has(start)).length;
  const newest = [...starts].reverse().find((start) => byWeek.has(start));
  return (
    <span className={`${styles.bars} ${weeks > 12 ? styles.barsDense : ""}`} role="img" aria-label={`${reported} of the last ${weeks} weeks reported`}>
      {starts.map((start) => {
        const entry = byWeek.get(start);
        return (
          <span
            key={start}
            className={entry ? `${styles.bar} ${start === newest ? styles.barLast : ""}` : styles.gap}
            style={entry ? { height: `${Math.max(8, Math.round((entry.attendance / max) * 100))}%` } : undefined}
            title={entry ? `${feedbackDate(entry.meetingDate)}: ${entry.attendance} came` : `Week of ${feedbackDate(start)}: nothing sent`}
          />
        );
      })}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 Sep": short enough for a 12-column chart on a phone. */
function chartDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const MOOD_CLASS: Record<FeedbackMood, string> = { hard: "moodHard", okay: "moodOkay", good: "moodGood", great: "moodGood" };

/**
 * The picked house in full (board M4b, right): a bar per week with the
 * count on top, the new people as a terracotta foot, the date and how the
 * leader said it went underneath. A missed week stays empty.
 */
export function AttendanceChart({ house, weeks = 12, now }: { house: FeedbackHouse; weeks?: number; now?: Date }) {
  const starts = weekStarts(weeks, now);
  const byWeek = new Map(house.entries.map((entry) => [weekOf(entry.meetingDate), entry]));
  const max = Math.max(24, ...house.entries.map((entry) => entry.attendance));
  const counts = house.entries.map((entry) => entry.attendance);
  const fresh = house.entries.reduce((sum, entry) => sum + entry.newNames.length, 0);
  const label =
    counts.length === 0
      ? `${houseTitle(house)}: nothing sent in the last ${weeks} weeks`
      : `${houseTitle(house)} attendance over ${weeks} weeks, ${starts
          .map((start) => byWeek.get(start)?.attendance ?? "no report")
          .join(", ")}, with ${fresh} new ${fresh === 1 ? "person" : "people"}`;
  return (
    // A year is too many columns for a count, date and word each: bars only.
    <div className={`${styles.chart} ${weeks > 12 ? styles.chartDense : ""}`} role="img" aria-label={label}>
      {starts.map((start) => {
        const entry = byWeek.get(start);
        const date = chartDate(entry?.meetingDate ?? start);
        if (!entry) {
          return (
            <div key={start} className={styles.col} aria-hidden="true">
              <span className={styles.colValue}>–</span>
              <span className={styles.colBarEmpty} />
              <span className={styles.colDate}>{date}</span>
              <span className={styles.colMood}>&nbsp;</span>
            </div>
          );
        }
        const height = Math.max(6, Math.round((entry.attendance / max) * 100));
        const newShare = entry.attendance > 0 ? Math.min(100, Math.round((entry.newNames.length / entry.attendance) * 100)) : 0;
        return (
          <div key={start} className={styles.col} aria-hidden="true">
            <span className={styles.colValue}>{entry.attendance}</span>
            <span className={styles.colTrack}>
              <span className={styles.colBar} style={{ height: `${height}%` }}>
                {newShare > 0 ? <span className={styles.colNew} style={{ height: `${newShare}%` }} /> : null}
              </span>
            </span>
            <span className={styles.colDate}>{date}</span>
            <span className={`${styles.colMood} ${styles[MOOD_CLASS[entry.mood]]}`}>{MOOD_LABEL[entry.mood]}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "Thandi Zulu" groups, then "No coach yet". A house with two coaches shows under both. */
function groups(houses: FeedbackHouse[]): Array<{ coach: string; houses: FeedbackHouse[] }> {
  const map = new Map<string, FeedbackHouse[]>();
  for (const house of houses) {
    for (const coach of house.coaches.length > 0 ? house.coaches : ["No coach yet"]) {
      map.set(coach, [...(map.get(coach) ?? []), house]);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "No coach yet" ? 1 : b === "No coach yet" ? -1 : a.localeCompare(b, "en")))
    .map(([coach, list]) => ({ coach, houses: list.sort((x, y) => x.number - y.number) }));
}

/** Board M4b: every house's last 4 weeks, 12 weeks or year, grouped by coach, and the picked house in full. */
export function FeedbackHistory({
  client = houseChurchesClient,
  canRotate,
}: {
  client?: HouseChurchesClient;
  /**
   * Who may make a house a new link. Defaults to the shell's viewer being a
   * Missio pastor, the same rule as the house page (abilities.place).
   */
  canRotate?: boolean;
}) {
  const viewer = useMissioViewer();
  const rotate = canRotate ?? (viewer ? isMissioPastor(viewer) : false);
  const [weeks, setWeeks] = useState<FeedbackWeeks>(12);
  const { state, retry } = useMissioLoad(() => client.feedbackHistory(weeks), [client, weeks]);
  const [picked, setPicked] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const houses = useMemo(() => (state.phase === "ready" ? state.data.houses : []), [state]);
  // "This week" is the last 7 days, so a house that met yesterday counts.
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recent = (house: FeedbackHouse) => house.entries.find((entry) => entry.meetingDate > cutoff);
  const reportedLastWeek = houses.filter((house) => recent(house));
  const cameLastWeek = reportedLastWeek.reduce((sum, house) => sum + (recent(house)?.attendance ?? 0), 0);
  const newLastWeek = reportedLastWeek.reduce((sum, house) => sum + (recent(house)?.newNames.length ?? 0), 0);
  // Open on the first house that has reported, as the board does; a tap picks another.
  const shownId = picked ?? houses.find((house) => house.entries.length > 0)?.houseId ?? null;
  const open = houses.find((house) => house.houseId === shownId) ?? null;

  function pick(id: string) {
    setPicked(id);
    // On a phone the house opens below the list; bring it into view.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 999px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
    }
  }

  return (
    <div className={`${ui.root} ${styles.page}`}>
      <Link href="/missio/house-churches" className={styles.back}>
        ← House churches
      </Link>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={`${ui.serif} ${styles.title}`}>Weekly feedback</h1>
          {state.phase === "ready" ? (
            <p className={styles.summary} data-testid="feedback-summary">
              {reportedLastWeek.length} of {houses.length} houses sent feedback in the last 7 days · {cameLastWeek} came
              {newLastWeek > 0 ? ` · ${newLastWeek} new` : ""}
            </p>
          ) : null}
        </div>
        <div className={styles.range} role="group" aria-label="Range" data-testid="feedback-range">
          {FEEDBACK_RANGES.map((range) => (
            <button
              key={range.weeks}
              type="button"
              className={weeks === range.weeks ? styles.rangeOn : undefined}
              aria-pressed={weeks === range.weeks}
              onClick={() => setWeeks(range.weeks)}
            >
              {range.label}
            </button>
          ))}
        </div>
        <Link href="/missio-feedback" className={`${ui.btn} ${ui.s} ${styles.results}`} data-testid="feedback-sunday-results">
          This Sunday’s results ↗
        </Link>
      </header>
      {state.phase === "loading" ? (
        <div className={`${ui.card} ${styles.state}`} role="status">
          Loading feedback…
        </div>
      ) : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="Feedback didn’t load." onRetry={retry} /> : null}
      {state.phase === "ready" && houses.length === 0 ? <div className={`${ui.card} ${styles.state}`}>No houses yet.</div> : null}
      {state.phase === "ready" && houses.length > 0 ? (
        <div className={styles.layout}>
          <div className={`${ui.card} ${styles.groups}`}>
            {groups(houses).map((group) => (
              <section key={group.coach} className={styles.group}>
                <h2 className={styles.groupHead}>
                  {group.coach}{" "}
                  <span className={styles.groupCount}>{group.houses.length === 1 ? "1 house" : `${group.houses.length} houses`}</span>
                </h2>
                <ul className={styles.tiles}>
                  {group.houses.map((house) => {
                    const last = house.entries[0];
                    const on = shownId === house.houseId;
                    return (
                      <li key={`${group.coach}-${house.houseId}`}>
                        <button
                          type="button"
                          className={`${styles.tile} ${on ? styles.tileOn : ""}`}
                          aria-pressed={on}
                          onClick={() => pick(house.houseId)}
                        >
                          <span className={styles.tileTop}>
                            <span className={`${ui.serif} ${styles.tileName}`}>{houseTitle(house)}</span>
                            <span className={`${ui.mono} ${styles.tileDay}`}>{meetingDayLabel(house.meetingDay).slice(0, 3)}</span>
                          </span>
                          <FeedbackBars entries={house.entries} weeks={weeks} />
                          <span className={styles.tileLast}>
                            {last ? (
                              <>
                                <b className={ui.num}>{last.attendance}</b> <span>came {feedbackDate(last.meetingDate)}</span>
                              </>
                            ) : (
                              <span>Nothing yet</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <aside ref={detailRef} className={`${ui.card} ${styles.detail}`} aria-live="polite">
            {open ? (
              <FeedbackDetail house={open} weeks={weeks} client={client} canRotate={rotate} />
            ) : (
              <p className={styles.quiet}>Choose a house to see what its leaders wrote.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

const monthName = new Intl.DateTimeFormat("en-ZA", { month: "long", timeZone: "UTC" });

function FeedbackDetail({
  house,
  weeks,
  client,
  canRotate,
}: {
  house: FeedbackHouse;
  weeks: number;
  client: Pick<HouseChurchesClient, "feedbackLink">;
  canRotate: boolean;
}) {
  const last = house.entries[0] ?? null;
  const first = house.entries[house.entries.length - 1] ?? null;
  const change = last && first && first !== last ? last.attendance - first.attendance : null;
  const fresh = house.entries.reduce((sum, entry) => sum + entry.newNames.length, 0);
  return (
    <div className={styles.detailBody} data-testid="feedback-detail">
      <div className={styles.detailHead}>
        <h2 className={`${ui.serif} ${styles.detailTitle}`}>{houseTitle(house)}</h2>
        <Link href={`/missio/house-churches/${encodeURIComponent(house.houseId)}`} className={styles.open}>
          Open house
        </Link>
      </div>
      {/* Keyed by house: picking another house starts with no link showing. */}
      <FeedbackLinkActions key={house.houseId} houseId={house.houseId} client={client} canRotate={canRotate} />
      {last ? (
        <div className={styles.stats}>
          <div>
            <div className={`${ui.num} ${styles.stat}`}>{last.attendance}</div>
            <div className={styles.statLabel}>last {dayName.format(new Date(`${last.meetingDate}T12:00:00Z`))}</div>
          </div>
          {change != null && first ? (
            <div>
              <div className={`${ui.num} ${styles.stat} ${change > 0 ? styles.up : ""}`}>
                {change > 0 ? `+${change}` : change === 0 ? "±0" : `${change}`}
              </div>
              <div className={styles.statLabel}>since {monthName.format(new Date(`${first.meetingDate}T12:00:00Z`))}</div>
            </div>
          ) : null}
          <div>
            <div className={`${ui.num} ${styles.stat} ${fresh > 0 ? styles.fresh : ""}`}>{fresh}</div>
            <div className={styles.statLabel}>new in {spanOf(weeks)}</div>
          </div>
        </div>
      ) : null}
      <AttendanceChart house={house} weeks={weeks} />
      {last ? (
        <div className={styles.legend} aria-hidden="true">
          <span>
            <i className={styles.keyCame} /> came
          </span>
          <span>
            <i className={styles.keyNew} /> of whom new
          </span>
          <span>word below = how the leader said it went</span>
        </div>
      ) : null}
      {house.entries.length === 0 ? (
        <p className={styles.quiet}>Nothing sent in {weeks === 52 ? "the last year" : `the last ${weeks} weeks`}.</p>
      ) : null}
      <ol className={styles.entries}>
        {house.entries.map((entry) => (
          <EntryItem key={entry.meetingDate} entry={entry} />
        ))}
      </ol>
    </div>
  );
}

export function EntryItem({ entry }: { entry: FeedbackEntry }) {
  const date = new Date(`${entry.meetingDate}T12:00:00Z`);
  return (
    <li className={styles.entry}>
      <p className={styles.entryHead}>
        <b>{entry.attendance} came</b> · {dayName.format(date)} {feedbackDate(entry.meetingDate)}
        <span className={`${styles.moodWord} ${styles[MOOD_CLASS[entry.mood]]}`}>{MOOD_LABEL[entry.mood]}</span>
      </p>
      {entry.newNames.length > 0 ? <p className={styles.entryLine}>New: {entry.newNames.join(", ")}</p> : null}
      {entry.notes ? <p className={styles.quote}>“{entry.notes}”</p> : null}
      {entry.prayer ? <p className={styles.entryLine}>Prayer: {entry.prayer}</p> : null}
    </li>
  );
}

/** The house page's "Weekly feedback" panel: last week, 12-week bars, and the leader's link. */
export function HouseFeedbackPanel({
  houseId,
  client = houseChurchesClient,
  canRotate,
}: {
  houseId: string;
  client?: Pick<HouseChurchesClient, "feedbackHistory" | "feedbackLink">;
  canRotate: boolean;
}) {
  const { state } = useMissioLoad(() => client.feedbackHistory(12), [client]);
  const house = state.phase === "ready" ? state.data.houses.find((row) => row.houseId === houseId) ?? null : null;
  const last = house?.entries[0] ?? null;

  return (
    <section className={`${ui.card} ${styles.panel}`} data-testid="house-feedback">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Weekly feedback</h2>
        <Link href="/missio/house-churches/feedback" className={styles.panelLink}>
          History
        </Link>
      </div>
      {state.phase === "loading" ? <p className={styles.quiet}>Loading…</p> : null}
      {state.phase === "error" ? <p className={styles.quiet}>Feedback didn’t load.</p> : null}
      {state.phase === "ready" ? (
        <>
          <span className={styles.panelBars}>
            <FeedbackBars entries={house?.entries ?? []} weeks={8} />
          </span>
          {last ? (
            <>
              <p className={styles.panelLast}>
                <b>
                  {last.attendance} came last {dayName.format(new Date(`${last.meetingDate}T12:00:00Z`))}
                </b>
                <span className={ui.ink2}>
                  {last.newNames.length > 0 ? ` · ${last.newNames.length} new` : ""} · {MOOD_LABEL[last.mood].toLowerCase()}
                </span>
              </p>
              {last.notes ? <p className={styles.panelQuote}>“{last.notes}”</p> : null}
            </>
          ) : (
            <p className={styles.quiet}>Nothing sent yet. Fill it in, or send the leader the link below; it takes about five minutes after the meeting.</p>
          )}
        </>
      ) : null}
      <FeedbackLinkActions houseId={houseId} client={client} canRotate={canRotate} />
    </section>
  );
}

/**
 * Fill in this week, Copy the leader’s link, Send on WhatsApp and (pastors
 * only) Make a new link. One copy, used by the house page's panel and the
 * Weekly feedback page's picked house. The link is made on first copy
 * (POST /api/missio/house-churches/:id/feedback/link), which also checks
 * the house is in this person's scope; rotating is refused there for
 * anyone who isn't a pastor, whatever this shows.
 */
export function FeedbackLinkActions({
  houseId,
  client = houseChurchesClient,
  canRotate,
}: {
  houseId: string;
  client?: Pick<HouseChurchesClient, "feedbackLink">;
  canRotate: boolean;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function getLink(rotate: boolean) {
    setPending(true);
    setNotice(null);
    try {
      const { path } = await client.feedbackLink(houseId, rotate);
      const url = `${typeof window === "undefined" ? "" : window.location.origin}${path}`;
      setLink(url);
      try {
        await navigator.clipboard?.writeText(url);
        setNotice(rotate ? "New link copied. The old one no longer works." : "Link copied. Send it to the leader.");
      } catch {
        setNotice(rotate ? "New link made. The old one no longer works." : "Here’s the link. Send it to the leader.");
      }
    } catch {
      setNotice("That didn’t work. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.linkBlock} data-testid="feedback-link-actions">
      <div className={styles.linkRow}>
        {/* Signed-in leaders fill it here; the link is for sending on. */}
        <Link className={`${ui.btn} ${ui.s} ${ui.sm} ${styles.linkBtn}`} href={`/missio-feedback/${houseId}`} data-testid="feedback-fill">
          Fill in this week
        </Link>
        <button
          type="button"
          className={`${ui.btn} ${ui.s} ${ui.sm} ${styles.linkBtn}`}
          disabled={pending}
          onClick={() => void getLink(false)}
          data-testid="feedback-copy"
        >
          Copy the leader’s link
        </button>
        {link ? (
          <a
            className={`${ui.btn} ${ui.s} ${ui.sm} ${styles.linkBtn}`}
            href={`https://wa.me/?text=${encodeURIComponent(`How was house church this week? It takes about five minutes: ${link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="feedback-whatsapp"
          >
            Send on WhatsApp
          </a>
        ) : null}
        {canRotate && link ? (
          <button
            type="button"
            className={`${ui.btn} ${ui.g} ${ui.sm} ${styles.linkBtn}`}
            disabled={pending}
            onClick={() => void getLink(true)}
            data-testid="feedback-rotate"
          >
            Make a new link
          </button>
        ) : null}
      </div>
      {link ? (
        <p className={`${styles.entryLine} ${styles.linkUrl}`} data-testid="feedback-link">
          {link}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.quiet} role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
