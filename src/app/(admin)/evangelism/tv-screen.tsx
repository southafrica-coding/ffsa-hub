"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getFeed, isOffline, type EvangelismStats, type ApiFailure } from "./api";
import {
  FEED_POLL_SECONDS,
  applyFeed,
  excerpt,
  expiryFromPayload,
  johannesburgClock,
  nextReplaceDelay,
  outcomeLabel,
  pruneExpiredStories,
  stripTvAuthors,
  tvStoryLine,
  visibleIdsForPoll,
  type Testimony,
} from "./logic";

type Board = {
  loaded: boolean;
  stories: Testimony[];
  stats: EvangelismStats | null;
  failure: ApiFailure | null;
  checkedAt: string | null;
  pollSeconds: number;
  /** A full replace failed and at least one story was dropped because its URL may have expired. */
  mediaStale: boolean;
  replaceRetrying: boolean;
};

const EMPTY_BOARD: Board = {
  loaded: false,
  stories: [],
  stats: null,
  failure: null,
  checkedAt: null,
  pollSeconds: FEED_POLL_SECONDS,
  mediaStale: false,
  replaceRetrying: false,
};

export function TvScreen() {
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  // -1 means "the newest story", which is the end of the chronological feed.
  const [index, setIndex] = useState(-1);
  const [clock, setClock] = useState(() => johannesburgClock());
  const [mounted, setMounted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const tick = () => setClock(johannesburgClock());
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let stopped = false;
    let pollTimer = 0;
    let replaceTimer = 0;
    let chain: Promise<void> = Promise.resolve();
    const cursor = { current: null as string | null };
    const delay = { current: FEED_POLL_SECONDS * 1000 };
    const stories = { current: [] as Testimony[] };
    const expiresAt = new Map<string, number>();
    const visibleOffset = { current: 0 };

    function stamp(ids: string[], payloadExpires: unknown) {
      const until = expiryFromPayload(payloadExpires);
      for (const id of ids) expiresAt.set(id, until);
    }

    function scheduleReplace(failed: boolean) {
      window.clearTimeout(replaceTimer);
      replaceTimer = window.setTimeout(() => {
        if (!stopped) enqueue("replace");
      }, nextReplaceDelay(failed));
    }

    function enqueue(mode: "append" | "replace") {
      chain = chain.then(async () => {
        if (stopped) return;
        const since = mode === "replace" ? null : cursor.current;
        const visible =
          mode === "append"
            ? visibleIdsForPoll(stories.current.map((row) => row.id), visibleOffset.current)
            : visibleIdsForPoll(stories.current.map((row) => row.id), 0);
        if (mode === "append") visibleOffset.current = visible.nextOffset;
        const result = await getFeed(since, visible.ids);
        if (stopped) return;

        if (!result.ok) {
          if (mode === "replace") scheduleReplace(true);
          const now = Date.now();
          const pruned = pruneExpiredStories(stories.current, expiresAt, now);
          const dropped = pruned.length !== stories.current.length;
          stories.current = pruned;
          for (const id of [...expiresAt.keys()]) {
            if (!pruned.some((row) => row.id === id)) expiresAt.delete(id);
          }
          setBoard((current) => ({
            ...current,
            loaded: true,
            stories: pruned,
            // An append failure is a feed failure. A replace failure must not
            // blank a screen whose 15 second polls are still working.
            failure: mode === "append" || current.stories.length === 0 ? result : current.failure,
            mediaStale: pruned.length === 0 && (dropped || current.mediaStale),
            replaceRetrying: mode === "replace" || current.replaceRetrying,
            checkedAt: johannesburgClock(),
          }));
          return;
        }

        const seconds = result.data.poll_after_seconds;
        if (Number.isFinite(seconds) && seconds >= 5 && seconds <= 120) delay.current = seconds * 1000;
        if (mode === "replace") cursor.current = result.data.cursor ?? null;
        else if (result.data.cursor) cursor.current = result.data.cursor;

        const removed = Array.isArray(result.data.removed_ids) ? result.data.removed_ids : [];
        const refreshed = Array.isArray(result.data.refreshed) ? result.data.refreshed : [];
        const incoming = result.data.testimonies ?? [];
        let next = stripTvAuthors(
          applyFeed(stories.current, {
            mode,
            testimonies: incoming,
            refreshed,
            removedIds: removed,
          })
        );
        const now = Date.now();
        stamp(incoming.map((row) => row.id), result.data.media_expires_at);
        stamp(refreshed.map((row) => row.id), result.data.media_expires_at);
        if (mode === "replace") {
          const keep = new Set(next.map((row) => row.id));
          for (const id of expiresAt.keys()) if (!keep.has(id)) expiresAt.delete(id);
          stamp([...keep], result.data.media_expires_at);
        }
        for (const id of removed) expiresAt.delete(id);
        const pruned = pruneExpiredStories(next, expiresAt, now);
        const droppedForExpiry = pruned.length !== next.length;
        next = pruned;
        stories.current = next;

        setBoard((current) => ({
          loaded: true,
          stories: next,
          stats: result.data.stats ?? current.stats,
          failure: null,
          checkedAt: johannesburgClock(),
          pollSeconds: Math.round(delay.current / 1000),
          mediaStale: mode === "replace" ? false : next.length === 0 && (droppedForExpiry || current.mediaStale),
          replaceRetrying: mode === "replace" ? false : current.replaceRetrying,
        }));
        if (mode === "replace") scheduleReplace(false);
      }).catch(() => {
        if (stopped) return;
        if (mode === "replace") scheduleReplace(true);
      });
    }

    function schedule() {
      pollTimer = window.setTimeout(() => {
        enqueue("append");
        if (!stopped) schedule();
      }, delay.current);
    }

    enqueue("replace");
    schedule();
    scheduleReplace(false);

    return () => {
      stopped = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(replaceTimer);
    };
  }, []);

  useEffect(() => {
    if (board.stories.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((current) => {
        const count = board.stories.length;
        const shown = current < 0 ? count - 1 : current;
        return (shown - 1 + count) % count;
      });
    }, 20_000);
    return () => window.clearInterval(id);
  }, [board.stories.length]);

  const newestId = board.stories[board.stories.length - 1]?.id ?? null;
  const [seenNewest, setSeenNewest] = useState<string | null>(null);
  useEffect(() => {
    if (!newestId || newestId === seenNewest) return;
    setIndex(-1);
    setSeenNewest(newestId);
  }, [newestId, seenNewest]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function fillScreen() {
    const node = document.getElementById("evangelism-tv");
    if (!node) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen().catch(() => undefined);
  }

  const count = board.stories.length;
  const shown = count === 0 ? 0 : index < 0 ? count - 1 : Math.min(index, count - 1);

  const screen = (
    <div id="evangelism-tv" className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-white text-ink">
      <header className="flex items-end justify-between gap-6 border-b border-ink px-6 pb-4 pt-5 md:px-10 md:pt-6">
        <div className="min-w-0">
          <div className="masthead-context">This month on the base</div>
          <h1 className="masthead-title">Evangelism</h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3 pb-1">
          <div className="font-display text-[clamp(28px,4vw,52px)] font-black leading-none tabular-nums">{clock}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void fillScreen()}
              className="border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
            >
              {fullscreen ? "Leave full screen" : "Fill the screen"}
            </button>
            <Link
              href="/evangelism"
              className="border border-ink bg-bone px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
            >
              Exit
            </Link>
          </div>
        </div>
      </header>

      <StatsStrip stats={board.stats} />

      <div className="min-h-0 flex-1">
        {!board.loaded && (
          <Center>
            <p className="font-display text-[clamp(36px,6vw,72px)] font-black uppercase leading-none">Opening</p>
            <p className="mt-4 text-[16px] text-[color:var(--text-secondary)]">Checking for published stories.</p>
          </Center>
        )}

        {board.loaded && board.stories.length === 0 && board.mediaStale && (
          <Center>
            <p className="font-display text-[clamp(36px,5vw,68px)] font-black uppercase leading-[0.92]">
              Pictures expired
            </p>
            <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-[color:var(--text-secondary)]">
              The full screen check failed, so these stories came down. Trying again.
            </p>
          </Center>
        )}

        {board.loaded && board.stories.length === 0 && !board.mediaStale && board.failure && (
          <Center>
            <p className="font-display text-[clamp(36px,5vw,68px)] font-black uppercase leading-[0.92]">
              {isOffline(board.failure) ? "Not switched on" : "The feed didn't answer"}
            </p>
            <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-[color:var(--text-secondary)]">
              {board.failure.message}
            </p>
            <p className="mono-label mt-6">Checks again every {board.pollSeconds}s</p>
          </Center>
        )}

        {board.loaded && board.stories.length === 0 && !board.mediaStale && !board.failure && (
          <Center>
            <p className="font-display text-[clamp(36px,5vw,68px)] font-black uppercase leading-[0.92]">
              Nothing published yet
            </p>
            <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-[color:var(--text-secondary)]">
              This screen checks every {board.pollSeconds} seconds. A story shows here once a publisher puts it on.
            </p>
          </Center>
        )}

        {board.stories[shown] && <Featured story={board.stories[shown]} stats={board.stats} />}
      </div>

      {board.stories.length > 1 && (
        <div className="flex gap-px overflow-x-auto border-t border-ink bg-rule">
          {board.stories.map((story, position) => {
            const on = position === shown;
            return (
              <button
                key={story.id}
                type="button"
                onClick={() => setIndex(position)}
                className={`min-w-[180px] flex-1 px-4 py-3 text-left font-mono text-[10px] font-bold uppercase leading-snug tracking-[0.08em] ${
                  on ? "bg-ink text-white" : "bg-bone text-ink"
                }`}
              >
                {story.title}
              </button>
            );
          })}
        </div>
      )}

      <footer className="flex items-center justify-between gap-4 border-t border-ink px-6 py-2 md:px-10">
        <span className="mono-label">
          {board.mediaStale
            ? "Pictures expired. Checking again."
            : board.replaceRetrying
              ? "Full refresh failed. Trying again."
              : board.failure && board.stories.length > 0
                ? "Last check failed. Trying again."
                : `Live · every ${board.pollSeconds}s`}
        </span>
        <span className="mono-label">{board.checkedAt ? `Last check ${board.checkedAt}` : "Waiting for the first check"}</span>
      </footer>
    </div>
  );

  if (!mounted) {
    return (
      <div className="px-8 py-16">
        <p className="font-display text-[40px] font-black uppercase">Evangelism screen</p>
      </div>
    );
  }

  return createPortal(screen, document.body);
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-start justify-center px-6 md:px-10">{children}</div>;
}

function StatsStrip({ stats }: { stats: EvangelismStats | null }) {
  const people = stats?.people_reached ?? 0;
  const decisions = stats?.decisions ?? 0;
  const count = stats?.published_count ?? 0;
  return (
    <div className="grid grid-cols-3 border-b border-ink">
      <Stat label="People reached" value={people} lead />
      <Stat label="Decisions" value={decisions} />
      <Stat label="Stories" value={count} foot={stats?.truncated ? "Totals are a floor" : undefined} />
    </div>
  );
}

function Stat({
  label,
  value,
  lead,
  foot,
}: {
  label: string;
  value: number;
  lead?: boolean;
  foot?: string;
}) {
  return (
    <div className={`border-r border-rule px-6 py-4 last:border-r-0 md:px-10 md:py-5 ${lead ? "bg-bone" : ""}`}>
      <div className="mono-label mb-2">{label}</div>
      <div className="flex items-end gap-3">
        <span className="numeral leading-none" style={{ fontSize: "clamp(40px, 6vw, 84px)" }}>
          {value.toLocaleString("en-ZA")}
        </span>
        {lead && <span className="mb-2 h-[3px] w-5 bg-yellow" />}
      </div>
      {foot && <div className="mt-2 font-mono text-[10px] tracking-[0.08em] text-[#55524A]">{foot}</div>}
    </div>
  );
}

function Featured({ story, stats }: { story: Testimony; stats: EvangelismStats | null }) {
  const media = [...story.media].sort((a, b) => a.sort_order - b.sort_order);
  const feature = media.find((item) => item.url) ?? null;
  const places = stats?.by_location?.slice(0, 5) ?? [];

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.8fr)]">
      <article className="min-h-0 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
        <div className="mono-label mb-3">{outcomeLabel(story.outcome)}</div>
        <h2 className="font-display text-[clamp(36px,5vw,76px)] font-black uppercase leading-[0.9]">
          {story.title}
        </h2>
        <p className="mt-4 text-[15px] text-[color:var(--text-secondary)]">
          {tvStoryLine(story)}
        </p>
        <p className="mt-6 max-w-3xl text-[clamp(16px,1.6vw,22px)] leading-relaxed">{excerpt(story.body)}</p>
        {feature?.url && places.length > 0 && (
          <p className="mono-label mt-6">
            This month
            {places.slice(0, 3).map((place) => ` · ${place.location_label} ${place.people_reached}`)}
          </p>
        )}
        <p className="mt-6 font-display text-[28px] font-black tabular-nums">
          {story.people_reached}
          <span className="ml-2 font-mono text-[11px] font-bold tracking-[0.14em] text-[color:var(--text-tertiary)]">
            REACHED
          </span>
          <span className="mx-3 text-[color:var(--text-tertiary)]">/</span>
          {story.decisions}
          <span className="ml-2 font-mono text-[11px] font-bold tracking-[0.14em] text-[color:var(--text-tertiary)]">
            DECISIONS
          </span>
        </p>
      </article>

      <aside className="min-h-0 border-t border-ink bg-bone lg:border-l lg:border-t-0">
        {feature?.url && feature.kind === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={feature.url} alt="" className="h-full max-h-[48vh] w-full object-cover lg:max-h-none" />
        ) : feature?.url && feature.kind === "video" ? (
          <video src={feature.url} controls playsInline className="h-full max-h-[48vh] w-full bg-ink object-contain lg:max-h-none" />
        ) : (
          <div className="flex h-full flex-col justify-between px-6 py-6 md:px-8">
            <div>
              <div className="mono-label mb-4">This month, by place</div>
              {places.length === 0 ? (
                <p className="text-[15px] text-[color:var(--text-secondary)]">No published stories in this month yet.</p>
              ) : (
                <ul>
                  {places.map((place) => (
                    <li key={place.location_label} className="flex items-baseline justify-between gap-4 border-b border-rule py-3">
                      <span className="text-[16px]">{place.location_label}</span>
                      <span className="numeral text-[28px]">{place.people_reached}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {stats?.truncated && (
              <p className="mono-label mt-4">More stories than this count</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
