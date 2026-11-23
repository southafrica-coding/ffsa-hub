"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, CircleHelp, Search, UsersRound } from "lucide-react";
import { canAccessMissio, isMissioPastor } from "./access";
import { missioClient, type MissioClient } from "./api";
import content from "./content.module.css";
import home from "./home.module.css";
import { followUpClient, type FollowUpClient } from "./follow-up/client";
import type { FollowUpStage } from "./follow-up/types";
import { houseChurchesClient, type HouseChurchesClient } from "./house-churches/client";
import type { HouseSummary } from "./house-churches/types";
import { coachNames } from "./house-churches/format";
import styles from "./shell.module.css";
import { useMissioViewer } from "./viewer";

import { HOUSE_SEATS, MULTIPLY_AT, readyToMultiply as isReadyToMultiply } from "./house-churches/format";

export { HOUSE_SEATS, MULTIPLY_AT };

function johannesburgNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Board M11a: "Wednesday 18 November". No year on a greeting.
  const date = [get("weekday"), get("day"), get("month")].filter(Boolean).join(" ");
  return { greeting, date };
}

export type HouseOverview = {
  houses: number;
  people: number;
  readyToMultiply: number;
  noCoLeader: number;
  noCoach: number;
  bars: { id: string; number: number; size: number; ready: boolean }[];
};

/** Pure: the numbers the Home card shows. An empty house raises no signal. */
export function houseOverview(houses: HouseSummary[]): HouseOverview {
  const sorted = [...houses].sort((a, b) => a.number - b.number);
  let people = 0;
  let readyToMultiply = 0;
  let noCoLeader = 0;
  let noCoach = 0;
  const bars = sorted.map((house) => {
    people += house.memberCount;
    const ready = isReadyToMultiply(house);
    if (ready) readyToMultiply += 1;
    if (house.memberCount > 0 && house.coLeaders.length === 0) noCoLeader += 1;
    if (house.memberCount > 0 && house.coaches.length === 0) noCoach += 1;
    return { id: house.id, number: house.number, size: house.memberCount, ready };
  });
  return { houses: sorted.length, people, readyToMultiply, noCoLeader, noCoach, bars };
}

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

function useLoad<T>(load: () => Promise<T>, enabled: boolean): [Load<T>, () => void] {
  const [value, setValue] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setValue({ state: "loading" });
    load().then(
      (data) => {
        if (live) setValue({ state: "ready", data });
      },
      () => {
        if (live) setValue({ state: "error" });
      }
    );
    return () => {
      live = false;
    };
  }, [load, enabled, attempt]);
  return [value, () => setAttempt((n) => n + 1)];
}

const OPEN_STAGES: { stage: FollowUpStage; label: string }[] = [
  { stage: "new", label: "New" },
  { stage: "contacted", label: "Contacted" },
  { stage: "visited_house", label: "Visited a house" },
];

function CardError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className={content.cardError} role="alert">
      <span>Couldn’t load {what}.</span>
      <button type="button" className={styles.textButton} onClick={retry}>
        Try again
      </button>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className={content.skeleton} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

/** First name for the greeting, from GET /api/me. Null when it isn't there. */
export async function readGreetingName(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("/api/me", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { profile?: { preferredName?: unknown; firstName?: unknown } };
    for (const value of [body.profile?.preferredName, body.profile?.firstName]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Board M11a: the greeting over the (still empty) Sunday photo slot. */
function Greeting({ date, greeting, name }: { date: string; greeting: string; name: string | null }) {
  return (
    <div className={home.hero} data-testid="home-hero">
      {/* Photo slot: a real Sunday photo goes here once photography is in. */}
      <div className={home.heroText}>
        <p className={home.heroDate}>{date}</p>
        <h1 className={home.heroTitle}>{name ? `${greeting}, ${name}` : greeting}</h1>
      </div>
    </div>
  );
}

function RowCard({
  href,
  icon,
  tone,
  title,
  sub,
  testId,
  className = "",
}: {
  href: string;
  icon: ReactNode;
  tone: "link" | "subtle";
  title: string;
  sub: string;
  testId?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={`${home.card} ${home.row} ${className}`} data-testid={testId}>
      <span className={`${home.rowIcon} ${tone === "link" ? home.rowIconLink : ""}`} aria-hidden="true">
        {icon}
      </span>
      <span className={home.rowText}>
        <span className={home.rowTitle}>{title}</span>
        <span className={home.rowSub}>{sub}</span>
      </span>
      <ChevronRight className={home.chev} aria-hidden="true" />
    </Link>
  );
}

export function MissioHome({
  houses = houseChurchesClient,
  followUp = followUpClient,
  people: peopleClient = missioClient,
  loadName = readGreetingName,
}: {
  houses?: HouseChurchesClient;
  followUp?: FollowUpClient;
  people?: Pick<MissioClient, "listPeople">;
  loadName?: () => Promise<string | null>;
} = {}) {
  const { greeting, date } = johannesburgNow();
  const viewer = useMissioViewer();
  const pastor = viewer != null && isMissioPastor(viewer);
  const inMissio = viewer != null && canAccessMissio(viewer);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadName().then(
      (value) => {
        if (live) setName(value);
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [loadName]);

  const loadHouses = useCallback(async () => ({ overview: houseOverview((await houses.listHouses()).houses) }), [houses]);
  const loadFollowUp = useCallback(async () => {
    const lists = await Promise.all(OPEN_STAGES.map(({ stage }) => followUp.list({ stage }).then((r) => r.people)));
    const all = lists.flat();
    return {
      stages: OPEN_STAGES.map((item, index) => ({ ...item, count: lists[index]?.length ?? 0 })),
      // Connect cards are filled in on a Sunday (board M5a).
      fromSunday: all.filter((item) => item.source === "connect_response").length,
      needReview: all.filter((item) => item.matchStatus === "pending_confirm").length,
    };
  }, [followUp]);
  const loadPeopleCount = useCallback(async () => (await peopleClient.listPeople({ limit: 1 })).total, [peopleClient]);

  const [houseLoad, retryHouses] = useLoad(loadHouses, pastor);
  const loadMine = useCallback(async () => (await houses.listHouses()).houses, [houses]);
  const [mineLoad, retryMine] = useLoad(loadMine, inMissio && !pastor);
  const [followLoad, retryFollow] = useLoad(loadFollowUp, pastor);
  const [peopleLoad] = useLoad(loadPeopleCount, pastor);

  const hero = <Greeting date={date} greeting={greeting} name={name} />;

  if (!pastor) {
    // Coaches and leaders: their own houses, nothing they can't act on.
    const mine = mineLoad.state === "ready" ? [...mineLoad.data].sort((a, b) => a.number - b.number) : [];
    return (
      <div className={`${content.page} ${content.reveal} ${home.page}`}>
        {hero}
        {!inMissio ? (
          <RowCard
            href="/missio/people"
            icon={<Search />}
            tone="subtle"
            title="Find someone"
            sub="Search everyone at Missio by name"
            testId="home-people"
          />
        ) : null}
        {inMissio && mineLoad.state === "loading" ? (
          <p className={styles.state} role="status">
            Loading your houses…
          </p>
        ) : null}
        {inMissio && mineLoad.state === "error" ? (
          <div className={styles.state} role="alert">
            <p>Your houses didn’t load.</p>
            <button type="button" className={styles.ghost} onClick={retryMine}>
              Try again
            </button>
          </div>
        ) : null}
        {inMissio && mineLoad.state === "ready" && mine.length === 0 ? (
          <p className={styles.state} data-testid="home-no-houses">
            No house is linked to you yet. A pastor sets who leads and coaches each house.
          </p>
        ) : null}
        {mine.length > 0 ? (
          <div className={home.stack} data-testid="home-my-houses">
            {mine.map((house) => (
              <RowCard
                key={house.id}
                href={`/missio/house-churches/${encodeURIComponent(house.id)}`}
                icon={<UsersRound />}
                tone="link"
                title={house.name?.trim() || `House ${house.number}`}
                sub={`${plural(house.memberCount, "person", "people")}${
                  house.coaches.length > 0 ? ` · coached by ${coachNames(house.coaches)}` : ""
                }`}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const overview = houseLoad.state === "ready" ? houseLoad.data.overview : null;
  const follow = followLoad.state === "ready" ? followLoad.data : null;
  const followTotal = follow ? follow.stages.reduce((sum, item) => sum + item.count, 0) : 0;
  const newCount = follow?.stages.find((item) => item.stage === "new")?.count ?? 0;
  const peopleTotal = peopleLoad.state === "ready" ? peopleLoad.data : null;

  return (
    <div className={`${content.page} ${content.reveal} ${home.page}`}>
      {hero}

      <div className={home.grid}>
        <section className={`${home.card} ${home.houses}`} data-testid="home-houses-card">
          <div className={home.cardHead}>
            <h2 className={home.cardTitle}>
              <Link href="/missio/house-churches" className={home.stretch} data-testid="home-houses">
                House churches
              </Link>
            </h2>
            <span className={home.headLink} aria-hidden="true">
              Open the map →
            </span>
            <ChevronRight className={home.chevPhone} aria-hidden="true" />
          </div>
          {houseLoad.state === "loading" ? <CardSkeleton /> : null}
          {houseLoad.state === "error" ? <CardError what="house churches" retry={retryHouses} /> : null}
          {overview ? (
            <>
              <dl className={home.stats}>
                <div>
                  <dd>{overview.houses}</dd>
                  <dt>houses</dt>
                </div>
                <div>
                  <dd>{overview.people}</dd>
                  <dt>members</dt>
                </div>
                {/* The board's third number is "new this month". Membership start
                    dates can't give it yet: the house-church import stamped every
                    imported member with the import day. So it stays off rather
                    than count the whole church as new. */}
              </dl>
              {overview.bars.length > 0 ? (
                <div
                  className={`${home.bars} ${home.deskOnly}`}
                  role="img"
                  aria-label={`House sizes, house 1 to ${overview.houses}: ${overview.bars.map((bar) => bar.size).join(", ")}. Green is ready to multiply.`}
                >
                  {overview.bars.map((bar) => (
                    <span
                      key={bar.id}
                      className={bar.ready ? home.barReady : undefined}
                      style={{ height: `${Math.max(8, Math.round((Math.min(bar.size, HOUSE_SEATS) / HOUSE_SEATS) * 100))}%` }}
                    />
                  ))}
                </div>
              ) : null}
              <div className={home.chips}>
                {overview.readyToMultiply > 0 ? (
                  <span className={`${home.chip} ${home.chipOlive}`}>{overview.readyToMultiply} ready to multiply</span>
                ) : null}
                {overview.noCoLeader > 0 ? <span className={`${home.chip} ${home.chipGold}`}>{overview.noCoLeader} no co-leader</span> : null}
                {/* Phone shows the two chips board M11a has; desktop adds no coach. */}
                {overview.noCoach > 0 ? (
                  <span className={`${home.chip} ${home.chipGold} ${home.deskOnly}`}>{overview.noCoach} no coach</span>
                ) : null}
              </div>
            </>
          ) : null}
        </section>

        <section className={`${home.card} ${home.notIn}`} data-testid="home-follow-card">
          <div className={home.notInHead}>
            <h2 className={home.notInTitle}>Not in a house yet</h2>
            {follow && follow.fromSunday > 0 ? <span className={home.desk}>{follow.fromSunday} from Sunday</span> : null}
          </div>
          {followLoad.state === "loading" ? <CardSkeleton /> : null}
          {followLoad.state === "error" ? <CardError what="follow-up" retry={retryFollow} /> : null}
          {follow ? (
            <>
              <div className={home.notInNum}>{followTotal}</div>
              <p className={home.notInSub}>
                {followTotal === 0
                  ? "Nobody is waiting"
                  : [`${newCount} new`, follow.fromSunday > 0 ? `${follow.fromSunday} from Sunday` : null].filter(Boolean).join(" · ")}
              </p>
              {followTotal > 0 ? (
                <>
                  <div
                    className={home.stageBar}
                    role="img"
                    aria-label={follow.stages.map((item) => `${item.count} ${item.label.toLowerCase()}`).join(", ")}
                  >
                    {follow.stages.map((item) =>
                      item.count > 0 ? <span key={item.stage} data-stage={item.stage} style={{ flexGrow: item.count }} /> : null
                    )}
                  </div>
                  <dl className={home.stageStats}>
                    {follow.stages.map((item) => (
                      <div key={item.stage}>
                        <dd>{item.count}</dd>
                        <dt>{item.label}</dt>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
              <div className={home.notInActions}>
                <Link href="/missio/follow-up" className={home.button} data-testid="home-follow-up">
                  Follow up
                </Link>
                {follow.needReview > 0 ? (
                  <span className={`${home.chip} ${home.chipGold} ${home.desk}`}>
                    <CircleHelp aria-hidden="true" />
                    {follow.needReview} need review
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </section>

        {/* Board M11a reads this from Planning Center. The Hub isn't linked to it yet,
            so the card says so instead of showing a plan. */}
        <Link href="/missio/sundays" className={`${home.card} ${home.sunday}`} data-testid="home-sunday">
          <span className={home.sundayHead}>
            <span className={home.cardTitle}>This Sunday</span>
            <span className={home.badge}>Planning Center · not linked</span>
          </span>
          <span className={home.sundayLead}>Sundays aren’t linked yet</span>
          <span className={home.sundayText}>
            Once Planning Center is connected, the plan, the team scheduled and availability answers show here.
          </span>
        </Link>

        <div className={home.side}>
          <RowCard
            href="/missio/volunteers"
            icon={<UsersRound />}
            tone="link"
            title="Want to serve"
            sub="No serving sign-ups in the Hub yet"
            testId="home-serve"
          />
          <RowCard
            href="/missio/people"
            icon={<Search />}
            tone="subtle"
            title="Find someone"
            sub={peopleTotal != null ? plural(peopleTotal, "person", "people") : "Search by name"}
            testId="home-people"
            className={home.phoneOnly}
          />
          <form className={`${home.card} ${home.find}`} action="/missio/people" role="search" data-testid="home-find">
            <div className={home.cardTitle} id="home-find-title">
              Find someone
            </div>
            <span className={home.search}>
              <Search aria-hidden="true" />
              <input name="q" placeholder="Name or phone" autoComplete="off" aria-labelledby="home-find-title" />
            </span>
          </form>
        </div>
      </div>
    </div>
  );
}
