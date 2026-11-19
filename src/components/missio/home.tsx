"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { canAccessMissio } from "./access";
import content from "./content.module.css";
import { followUpClient, type FollowUpClient } from "./follow-up/client";
import type { FollowUpStage } from "./follow-up/types";
import { houseChurchesClient, type HouseChurchesClient } from "./house-churches/client";
import type { HouseSummary } from "./house-churches/types";
import styles from "./shell.module.css";
import { useMissioViewer } from "./viewer";

import { HOUSE_SEATS, MULTIPLY_AT } from "./house-churches/format";

export { HOUSE_SEATS, MULTIPLY_AT };

function johannesburgNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = [get("weekday"), get("day"), get("month"), get("year")].filter(Boolean).join(" ");
  return { greeting, date };
}

export type HouseOverview = {
  houses: number;
  people: number;
  readyToMultiply: number;
  noCoLeader: number;
  noLeader: number;
  bars: { id: string; number: number; size: number; ready: boolean }[];
};

/** Pure: the numbers the Home card shows. An empty house raises no signal. */
export function houseOverview(houses: HouseSummary[]): HouseOverview {
  const sorted = [...houses].sort((a, b) => a.number - b.number);
  let people = 0;
  let readyToMultiply = 0;
  let noCoLeader = 0;
  let noLeader = 0;
  const bars = sorted.map((house) => {
    people += house.memberCount;
    const ready = house.memberCount >= MULTIPLY_AT && house.coLeaders.length > 0;
    if (ready) readyToMultiply += 1;
    if (house.memberCount > 0 && house.coLeaders.length === 0) noCoLeader += 1;
    if (house.memberCount > 0 && house.leaders.length === 0) noLeader += 1;
    return { id: house.id, number: house.number, size: house.memberCount, ready };
  });
  return { houses: sorted.length, people, readyToMultiply, noCoLeader, noLeader, bars };
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

export function MissioHome({
  houses = houseChurchesClient,
  followUp = followUpClient,
}: {
  houses?: HouseChurchesClient;
  followUp?: FollowUpClient;
} = {}) {
  const { greeting, date } = johannesburgNow();
  const viewer = useMissioViewer();
  const pastor = viewer != null && canAccessMissio(viewer);

  const loadHouses = useCallback(async () => {
    const [list, review] = await Promise.all([houses.listHouses(), houses.listReview()]);
    return { overview: houseOverview(list.houses), toReview: review.items.length };
  }, [houses]);
  const loadFollowUp = useCallback(async () => {
    const counts = await Promise.all(OPEN_STAGES.map(({ stage }) => followUp.list({ stage }).then((r) => r.people.length)));
    return OPEN_STAGES.map((item, index) => ({ ...item, count: counts[index] ?? 0 }));
  }, [followUp]);

  const [houseLoad, retryHouses] = useLoad(loadHouses, pastor);
  const [followLoad, retryFollow] = useLoad(loadFollowUp, pastor);

  const people = (
    <Link href="/missio/people" className={`${styles.card} ${content.card} ${content.rowCard}`} data-testid="home-people">
      <div>
        <div className={`${styles.cardTitle} ${content.cardTitle}`}>Find someone</div>
        <p className={`${styles.cardBody} ${content.cardBody}`}>Search everyone at Missio by name.</p>
      </div>
      <span className={content.go} aria-hidden="true">
        →
      </span>
    </Link>
  );

  if (!pastor) {
    return (
      <div className={`${content.page} ${content.reveal}`}>
        <p className={`${styles.eyebrow} ${content.eyebrow}`}>{date}</p>
        <h1 className={content.title}>{greeting}</h1>
        <div className={content.solo}>{people}</div>
      </div>
    );
  }

  const overview = houseLoad.state === "ready" ? houseLoad.data.overview : null;
  const toReview = houseLoad.state === "ready" ? houseLoad.data.toReview : 0;
  const followTotal = followLoad.state === "ready" ? followLoad.data.reduce((sum, item) => sum + item.count, 0) : 0;

  return (
    <div className={`${content.page} ${content.reveal}`}>
      <p className={`${styles.eyebrow} ${content.eyebrow}`}>{date}</p>
      <h1 className={content.title}>{greeting}</h1>

      <div className={content.homeGrid}>
        <section className={`${styles.card} ${content.card} ${content.wide}`} data-testid="home-houses-card">
          <div className={content.cardHead}>
            <h2 className={content.cardHeading}>House churches</h2>
            <Link href="/missio/house-churches" className={content.cardLink} data-testid="home-houses">
              All houses
            </Link>
          </div>
          {houseLoad.state === "loading" ? <CardSkeleton /> : null}
          {houseLoad.state === "error" ? <CardError what="house churches" retry={retryHouses} /> : null}
          {overview ? (
            <>
              <dl className={content.stats}>
                <div>
                  <dd>{overview.houses}</dd>
                  <dt>houses</dt>
                </div>
                <div>
                  <dd>{overview.people}</dd>
                  <dt>people in houses</dt>
                </div>
              </dl>
              <div
                className={content.bars}
                role="img"
                aria-label={`House sizes, house 1 to ${overview.houses}: ${overview.bars.map((bar) => bar.size).join(", ")}`}
              >
                {overview.bars.map((bar) => (
                  <span
                    key={bar.id}
                    className={bar.ready ? content.barReady : undefined}
                    style={{ height: `${Math.max(6, Math.round((Math.min(bar.size, HOUSE_SEATS) / HOUSE_SEATS) * 100))}%` }}
                  />
                ))}
              </div>
              <p className={content.caption}>One bar per house. Taller is bigger, out of {HOUSE_SEATS}.</p>
              <div className={content.chips}>
                {overview.readyToMultiply > 0 ? (
                  <span className={`${content.chip} ${content.chipOlive}`}>{overview.readyToMultiply} ready to multiply</span>
                ) : null}
                {overview.noCoLeader > 0 ? (
                  <span className={`${content.chip} ${content.chipGold}`}>{overview.noCoLeader} with no co-leader</span>
                ) : null}
                {overview.noLeader > 0 ? (
                  <span className={`${content.chip} ${content.chipGold}`}>{overview.noLeader} with no leader</span>
                ) : null}
              </div>
              {toReview > 0 ? (
                <Link href="/missio/house-churches/review" className={content.notice} data-testid="home-review">
                  <span>
                    <b>
                      {toReview} {toReview === 1 ? "name" : "names"} to review
                    </b>{" "}
                    from the house church sheet. The numbers above grow as you sort them.
                  </span>
                  <span className={content.go} aria-hidden="true">
                    →
                  </span>
                </Link>
              ) : null}
            </>
          ) : null}
        </section>

        <section className={`${styles.card} ${content.card}`} data-testid="home-follow-card">
          <div className={content.cardHead}>
            <h2 className={content.cardHeading}>Not in a house yet</h2>
          </div>
          {followLoad.state === "loading" ? <CardSkeleton /> : null}
          {followLoad.state === "error" ? <CardError what="follow-up" retry={retryFollow} /> : null}
          {followLoad.state === "ready" ? (
            <>
              <div className={content.big}>{followTotal}</div>
              {followTotal === 0 ? (
                <p className={content.caption}>Nobody is waiting. New connect cards show up here.</p>
              ) : (
                <dl className={`${content.stats} ${content.statsSmall}`}>
                  {followLoad.data.map((item) => (
                    <div key={item.stage}>
                      <dd>{item.count}</dd>
                      <dt>{item.label}</dt>
                    </div>
                  ))}
                </dl>
              )}
              <Link href="/missio/follow-up" className={content.action} data-testid="home-follow-up">
                Follow up
              </Link>
            </>
          ) : null}
        </section>

        {people}
      </div>
    </div>
  );
}
