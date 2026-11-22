"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import content from "../content.module.css";
import shell from "../shell.module.css";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { houseTitle, meetingDayLabel } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { AllHousesLink } from "../house-churches/present";
import { HouseStatus } from "../house-churches/status";
import type { FeedbackEntry, FeedbackHouse, FeedbackMood } from "../house-churches/types";
import styles from "./history.module.css";

export const MOOD_LABEL: Record<FeedbackMood, string> = { hard: "Hard", okay: "Okay", good: "Good", great: "Great" };

const shortDate = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
const dayName = new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: "UTC" });

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

/** One bar per week. A missed week is a gap, never a zero. */
export function FeedbackBars({ entries, weeks = 12, now }: { entries: FeedbackEntry[]; weeks?: number; now?: Date }) {
  const starts = weekStarts(weeks, now);
  const byWeek = new Map(entries.map((entry) => [weekOf(entry.meetingDate), entry]));
  const max = Math.max(24, ...entries.map((entry) => entry.attendance));
  const reported = starts.filter((start) => byWeek.has(start)).length;
  return (
    <span className={styles.bars} role="img" aria-label={`${reported} of the last ${weeks} weeks reported`}>
      {starts.map((start) => {
        const entry = byWeek.get(start);
        return (
          <span
            key={start}
            className={entry ? `${styles.bar} ${styles[`mood_${entry.mood}`] ?? ""}` : styles.gap}
            style={entry ? { height: `${Math.max(8, Math.round((entry.attendance / max) * 100))}%` } : undefined}
            title={entry ? `${feedbackDate(entry.meetingDate)}: ${entry.attendance} came` : `Week of ${feedbackDate(start)}: nothing sent`}
          />
        );
      })}
    </span>
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

/** Board M4b: every house's last 12 weeks, grouped by coach, and the picked house in full. */
export function FeedbackHistory({ client = houseChurchesClient }: { client?: HouseChurchesClient }) {
  const { state, retry } = useMissioLoad(() => client.feedbackHistory(12), [client]);
  const [picked, setPicked] = useState<string | null>(null);
  const houses = useMemo(() => (state.phase === "ready" ? state.data.houses : []), [state]);
  // "This week" is the last 7 days, so a house that met yesterday counts.
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recent = (house: FeedbackHouse) => house.entries.find((entry) => entry.meetingDate > cutoff);
  const reportedLastWeek = houses.filter((house) => recent(house));
  const cameLastWeek = reportedLastWeek.reduce((sum, house) => sum + (recent(house)?.attendance ?? 0), 0);
  const open = houses.find((house) => house.houseId === picked) ?? null;

  return (
    <div className={`${content.page} ${styles.root}`}>
      <AllHousesLink />
      <h1 className={content.title}>Weekly feedback</h1>
      <p className={content.lede}>
        <Link href="/missio-feedback" data-testid="feedback-sunday-results">
          This Sunday’s results ↗
        </Link>
      </p>
      {state.phase === "ready" ? (
        <p className={`${shell.lede} ${content.lede}`} data-testid="feedback-summary">
          {reportedLastWeek.length} of {houses.length} houses sent feedback in the last 7 days · {cameLastWeek} came
        </p>
      ) : null}
      {state.phase === "loading" ? (
        <div className={shell.state} role="status">
          Loading feedback…
        </div>
      ) : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="Feedback didn’t load." onRetry={retry} /> : null}
      {state.phase === "ready" && houses.length === 0 ? <div className={shell.state}>No houses yet.</div> : null}
      {state.phase === "ready" && houses.length > 0 ? (
        <div className={styles.layout}>
          <div className={styles.groups}>
            {groups(houses).map((group) => (
              <section key={group.coach} className={styles.group}>
                <h2>
                  {group.coach} <span className={styles.groupCount}>{group.houses.length === 1 ? "1 house" : `${group.houses.length} houses`}</span>
                </h2>
                <ul className={styles.houseList}>
                  {group.houses.map((house) => {
                    const last = house.entries[0];
                    return (
                      <li key={`${group.coach}-${house.houseId}`}>
                        <button
                          type="button"
                          className={`${styles.houseRow} ${picked === house.houseId ? styles.houseOn : ""}`}
                          aria-pressed={picked === house.houseId}
                          onClick={() => setPicked(house.houseId)}
                        >
                          <span className={styles.houseName}>{houseTitle(house)}</span>
                          <span className={styles.houseDay}>{meetingDayLabel(house.meetingDay).slice(0, 3)}</span>
                          <FeedbackBars entries={house.entries} />
                          <span className={styles.houseLast}>{last ? `${last.attendance} · ${feedbackDate(last.meetingDate)}` : "Nothing yet"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <aside className={styles.detail} aria-live="polite">
            {open ? (
              <FeedbackDetail house={open} />
            ) : (
              <p className={styles.quiet}>Choose a house to see what its leaders wrote.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function FeedbackDetail({ house }: { house: FeedbackHouse }) {
  return (
    <div data-testid="feedback-detail">
      <div className={styles.detailHead}>
        <h2>{houseTitle(house)}</h2>
        <Link href={`/missio/house-churches/${encodeURIComponent(house.houseId)}`} className={styles.open}>
          Open house
        </Link>
      </div>
      <FeedbackBars entries={house.entries} />
      {house.entries.length === 0 ? <p className={styles.quiet}>Nothing sent in the last 12 weeks.</p> : null}
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
        <span className={`${styles.moodTag} ${styles[`mood_${entry.mood}`] ?? ""}`}>{MOOD_LABEL[entry.mood]}</span>
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
  const [link, setLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const house = state.phase === "ready" ? state.data.houses.find((row) => row.houseId === houseId) ?? null : null;
  const last = house?.entries[0] ?? null;

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
    <section className={styles.detail} data-testid="house-feedback">
      <div className={styles.detailHead}>
        <h2>Weekly feedback</h2>
        <Link href="/missio/house-churches/feedback" className={styles.open}>
          All houses
        </Link>
      </div>
      {state.phase === "loading" ? <p className={styles.quiet}>Loading…</p> : null}
      {state.phase === "error" ? <p className={styles.quiet}>Feedback didn’t load.</p> : null}
      {state.phase === "ready" ? (
        <>
          <FeedbackBars entries={house?.entries ?? []} />
          {last ? (
            <ol className={styles.entries}>
              <EntryItem entry={last} />
            </ol>
          ) : (
            <p className={styles.quiet}>Nothing sent yet. Fill it in, or send the leader the link below; it takes about five minutes after the meeting.</p>
          )}
        </>
      ) : null}
      <div className={styles.linkRow}>
        {/* Signed-in leaders fill it here; the link is for sending on. */}
        <Link className={shell.ghost} href={`/missio-feedback/${houseId}`} data-testid="feedback-fill">
          Fill in this week
        </Link>
        <button type="button" className={shell.ghost} disabled={pending} onClick={() => void getLink(false)} data-testid="feedback-copy">
          Copy the leader’s link
        </button>
        {link ? (
          <a className={shell.ghost} href={`https://wa.me/?text=${encodeURIComponent(`How was house church this week? It takes about five minutes: ${link}`)}`} target="_blank" rel="noopener noreferrer">
            Send on WhatsApp
          </a>
        ) : null}
        {canRotate && link ? (
          <button type="button" className={shell.textButton} disabled={pending} onClick={() => void getLink(true)}>
            Make a new link
          </button>
        ) : null}
      </div>
      {link ? <p className={styles.entryLine} data-testid="feedback-link">{link}</p> : null}
      {notice ? (
        <p className={styles.quiet} role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
