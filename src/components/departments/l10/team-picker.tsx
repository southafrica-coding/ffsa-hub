"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createL10Api, l10Pages, L10_MEETING_ALREADY_OPEN, type FailureKind } from "./api";
import { formatDay, formatHm, runningMeetingOf, nextMeetingStart, teamStats, type TeamStats } from "./derive";
import type { L10Meeting, L10Team } from "./types";
import { BackLink, Masthead, Notice, failureCopy, useNow } from "./ui";
import styles from "./l10.module.css";

/** A team whose meeting starts within this many minutes gets the live bar. */
const SOON_MINUTES = 60;

export interface TeamPickerCard {
  team: L10Team;
  stats: TeamStats | null;
  live: L10Meeting | null;
}

type Load = { state: "loading" } | { state: "failed"; kind: FailureKind } | { state: "ready"; cards: TeamPickerCard[] };

export function TeamPicker({ slug, departmentName }: { slug: string; departmentName: string }) {
  const api = useMemo(() => createL10Api(slug), [slug]);
  const pages = l10Pages(slug);
  const router = useRouter();
  const now = useNow(30_000);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<FailureKind | null>(null);
  const [startErrorCode, setStartErrorCode] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState<{ teamId: string; meetingId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await api.listTeams();
      if (cancelled) return;
      if (!list.ok) return setLoad({ state: "failed", kind: list.kind });
      const teams = list.data.teams.filter((team) => team.is_active).sort((a, b) => a.sort_order - b.sort_order);
      // The list may not carry the card numbers, so each team is read once.
      const details = await Promise.all(teams.map((team) => api.getTeam(team.id)));
      if (cancelled) return;
      setLoad({
        state: "ready",
        cards: teams.map((team, index) => {
          const detail = details[index];
          return detail?.ok
            ? { team, stats: teamStats(detail.data), live: runningMeetingOf(detail.data) }
            : { team, stats: null, live: null };
        }),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // One yellow bar per screen: a live meeting first, else the soonest start.
  const highlighted = useMemo(() => {
    if (load.state !== "ready") return null;
    const live = load.cards.find((card) => card.live);
    if (live) return live.team.id;
    let best: { id: string; start: number } | null = null;
    for (const card of load.cards) {
      const start = nextMeetingStart(card.team, now);
      if (start != null && start - now <= SOON_MINUTES * 60_000 && (!best || start < best.start)) {
        best = { id: card.team.id, start };
      }
    }
    return best?.id ?? null;
  }, [load, now]);

  async function start(teamId: string) {
    setStarting(teamId);
    setStartError(null);
    setStartErrorCode(null);
    setJoinOpen(null);
    const result = await api.startMeeting(teamId);
    if (result.ok && result.data?.meeting?.id) {
      router.push(pages.meeting(teamId, result.data.meeting.id));
      return;
    }
    setStarting(null);
    if (!result.ok) {
      setStartError(result.kind);
      setStartErrorCode(result.code);
      if (result.code === L10_MEETING_ALREADY_OPEN) {
        let meetingId = result.meetingId;
        if (!meetingId) {
          const again = await api.getTeam(teamId);
          meetingId = again.ok ? runningMeetingOf(again.data)?.id ?? null : null;
        }
        if (meetingId) setJoinOpen({ teamId, meetingId });
      }
      return;
    }
    setStartError("error");
  }

  const count = load.state === "ready" ? load.cards.length : null;

  return (
    <div className={`${styles.root} ${styles.page}`}>
      <BackLink href="/departments">Departments</BackLink>
      <Masthead
        title={departmentName}
        context={
          <>
            <span>L10{count != null ? ` · ${count} ${count === 1 ? "team" : "teams"}` : ""}</span>
            <span aria-hidden="true">/</span>
            <span>tap a team</span>
          </>
        }
      />

      {startError ? <Notice>{failureCopy(startError, startErrorCode)}</Notice> : null}
      {joinOpen ? (
        <p className={styles.joinOpen}>
          <Link href={pages.meeting(joinOpen.teamId, joinOpen.meetingId)} className={styles.btnYellow}>
            Join the open meeting
          </Link>
        </p>
      ) : null}

      {load.state === "loading" ? <p className={styles.empty}>Loading teams…</p> : null}
      {load.state === "failed" ? <Notice>{failureCopy(load.kind)}</Notice> : null}
      {load.state === "ready" && load.cards.length === 0 ? (
        <p className={styles.empty}>No L10 teams yet.</p>
      ) : null}

      {load.state === "ready" && load.cards.length > 0 ? (
        <ul className={styles.cards}>
          {load.cards.map((card) => (
            <TeamCard
              key={card.team.id}
              card={card}
              now={now}
              highlighted={card.team.id === highlighted}
              href={pages.team(card.team.id)}
              meetingHref={card.live ? pages.meeting(card.team.id, card.live.id) : null}
              starting={starting === card.team.id}
              onStart={() => start(card.team.id)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TeamCard({
  card,
  now,
  highlighted,
  href,
  meetingHref,
  starting,
  onStart,
}: {
  card: TeamPickerCard;
  now: number;
  highlighted: boolean;
  href: string;
  meetingHref: string | null;
  starting: boolean;
  onStart: () => void;
}) {
  const { team, stats, live } = card;
  const start = nextMeetingStart(team, now);
  const zone = team.meeting_timezone;
  const minutes = start != null ? Math.max(0, Math.ceil((start - now) / 60_000)) : null;
  const next = live
    ? `In progress · started ${formatHm(Date.parse(live.started_at), zone)}`
    : start != null
      ? `Next · ${formatDay(start, zone)} · ${formatHm(start, zone)}`
      : "No meeting time set";
  const rockShare = stats && stats.rocksTotal > 0 ? stats.rocksOnTrack / stats.rocksTotal : 0;

  return (
    <li className={highlighted ? styles.cardLive : styles.card}>
      {highlighted ? (
        live && meetingHref ? (
          <Link href={meetingHref} className={styles.liveBar}>
            <span>In progress</span>
            <span>Resume →</span>
          </Link>
        ) : (
          <button type="button" className={`${styles.liveBar} w-full`} onClick={onStart} disabled={starting}>
            <span>{minutes === 0 ? "Starts now" : `Starts in ${minutes} min`}</span>
            <span>{starting ? "Starting…" : "Start →"}</span>
          </button>
        )
      ) : null}
      <Link href={href} className="block text-inherit no-underline">
        <div className={styles.cardBody}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardName}>{team.name}</h2>
            <span className={styles.cardArrow} aria-hidden="true">
              →
            </span>
          </div>
          <p className={styles.cardNext}>{next}</p>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statNum}>{stats ? stats.openIssues : "—"}</div>
              <div className={styles.statLabel}>Open issues</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>{stats ? stats.openTodos : "—"}</div>
              <div className={styles.statLabel}>Open to-dos</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>
                {stats ? (
                  <>
                    {stats.rocksOnTrack}
                    <span className="text-[0.6em] text-[var(--text-quiet)]">/{stats.rocksTotal}</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div className={`${styles.statLabel} ${styles.statLabelWrap}`}>Rocks on track</div>
              {stats && stats.rocksTotal > 0 ? (
                <div className={styles.meter} aria-hidden="true">
                  <div className={styles.meterFill} style={{ width: `${Math.round(rockShare * 100)}%` }} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Presentational picker, for tests and the live page's ready state. */
export function TeamPickerScreen({
  slug,
  departmentName,
  cards,
  now,
  highlighted = null,
  startError = null,
  startErrorCode = null,
  joinHref = null,
  starting = null,
  onStart,
}: {
  slug: string;
  departmentName: string;
  cards: TeamPickerCard[];
  now: number;
  highlighted?: string | null;
  startError?: FailureKind | null;
  startErrorCode?: string | null;
  joinHref?: string | null;
  starting?: string | null;
  onStart?: (teamId: string) => void;
}) {
  const pages = l10Pages(slug);
  const count = cards.length;
  return (
    <div className={`${styles.root} ${styles.page}`}>
      <BackLink href="/departments">Departments</BackLink>
      <Masthead
        title={departmentName}
        context={
          <>
            <span>L10{count != null ? ` · ${count} ${count === 1 ? "team" : "teams"}` : ""}</span>
            <span aria-hidden="true">/</span>
            <span>tap a team</span>
          </>
        }
      />
      {startError ? <Notice>{failureCopy(startError, startErrorCode)}</Notice> : null}
      {joinHref ? (
        <p className={styles.joinOpen}>
          <Link href={joinHref} className={styles.btnYellow}>
            Join the open meeting
          </Link>
        </p>
      ) : null}
      {count === 0 ? <p className={styles.empty}>No L10 teams yet.</p> : null}
      {count > 0 ? (
        <ul className={styles.cards}>
          {cards.map((card) => (
            <TeamCard
              key={card.team.id}
              card={card}
              now={now}
              highlighted={card.team.id === highlighted}
              href={pages.team(card.team.id)}
              meetingHref={card.live ? pages.meeting(card.team.id, card.live.id) : null}
              starting={starting === card.team.id}
              onStart={() => onStart?.(card.team.id)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

