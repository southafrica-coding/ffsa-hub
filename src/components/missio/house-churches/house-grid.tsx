"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CAMPUS_LABEL } from "../access";
import content from "../content.module.css";
import shell from "../shell.module.css";
import { houseChurchesClient, type HouseChurchesClient } from "./client";
import {
  coachNames,
  HOUSE_SEATS,
  SIGNAL_LABEL,
  houseSignals,
  houseTitle,
  initialsOf,
  leadingLine,
  peopleCount,
  shortDay,
} from "./format";
import { useMissioLoad } from "./load";
import { HouseMap } from "./house-map";
import { HouseStatus } from "./status";
import type { HouseCampus, HouseSummary } from "./types";
import styles from "./house-churches.module.css";

type Sort = "size" | "number";
type View = "map" | "grid";
type CampusFilter = "" | HouseCampus;

/** Grid view (board M4d). Sorted biggest first, so houses ready to multiply lead. */
export function HouseChurchGrid({ client = houseChurchesClient }: { client?: HouseChurchesClient }) {
  const { state, retry } = useMissioLoad(() => client.listHouses(), [client]);
  const canWrite = state.phase === "ready" && state.data.canWrite;
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [campus, setCampus] = useState<CampusFilter>("");
  const [attention, setAttention] = useState(false);
  const [sort, setSort] = useState<Sort>("size");
  const [coach, setCoach] = useState("");
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    if (!canWrite) {
      setReviewCount(null);
      return;
    }
    let active = true;
    client.listReview().then(
      (page) => {
        if (active) setReviewCount(page.items.length);
      },
      () => {
        if (active) setReviewCount(null);
      }
    );
    return () => {
      active = false;
    };
  }, [canWrite, client]);

  const houses = useMemo(() => (state.phase === "ready" ? state.data.houses : []), [state]);
  const total = houses.reduce((sum, house) => sum + Math.max(0, house.memberCount), 0);
  const campuses = useMemo(() => [...new Set(houses.map((house) => house.campus))].sort(), [houses]);
  const coaches = useMemo(() => {
    const seen = new Map<string, string>();
    for (const house of houses) for (const each of house.coaches) seen.set(each.contactId, each.displayName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
  }, [houses]);
  // The map is the default once any house has a coach; before that every
  // house would sit under "No coach yet", so the grid is clearer.
  const shownView: View = view ?? (coaches.length > 0 ? "map" : "grid");
  const shown = useMemo(() => {
    const list = houses.filter((house) => {
      if (campus && house.campus !== campus) return false;
      if (attention && houseSignals(house).length === 0) return false;
      if (coach === "none" && house.coaches.length > 0) return false;
      if (coach && coach !== "none" && !house.coaches.some((each) => each.contactId === coach)) return false;
      return true;
    });
    return list.sort((a, b) => (sort === "size" ? b.memberCount - a.memberCount || a.number - b.number : a.number - b.number));
  }, [houses, campus, attention, sort, coach]);

  return (
    <div className={`${content.page} ${styles.root}`}>
      <div className={styles.reviewHead}>
        <div>
          <h1 className={content.title}>House churches</h1>
          {state.phase === "ready" && houses.length > 0 ? (
            <p className={`${shell.lede} ${content.lede}`} data-testid="house-totals">
              {houses.length === 1 ? "1 house" : `${houses.length} houses`} · {total === 1 ? "1 member" : `${total} members`}
              {coaches.length > 0 ? ` · ${coaches.length === 1 ? "1 coach" : `${coaches.length} coaches`}` : ""}
            </p>
          ) : null}
        </div>
        <div className={styles.headLinks}>
          {state.phase === "ready" && houses.length > 0 ? (
            <Link href="/missio/house-churches/feedback" className={`${shell.ghost} ${styles.reviewButton}`} data-testid="feedback-link">
              Weekly feedback
            </Link>
          ) : null}
          {canWrite ? (
            <Link href="/missio/house-churches/review" className={`${shell.ghost} ${styles.reviewButton}`} data-testid="review-names">
              {reviewCount != null && reviewCount > 0 ? `Review names (${reviewCount})` : "Review names"}
            </Link>
          ) : null}
        </div>
      </div>

      {state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading house churches…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="House churches didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" && houses.length === 0 ? (
        <div className={shell.state} data-state="empty">
          No house churches yet.
        </div>
      ) : null}

      {state.phase === "ready" && houses.length > 0 ? (
        <div className={styles.viewSwitch} role="group" aria-label="View">
          <FilterChip on={shownView === "map"} onClick={() => setView("map")}>
            Map
          </FilterChip>
          <FilterChip on={shownView === "grid"} onClick={() => setView("grid")}>
            Grid
          </FilterChip>
        </div>
      ) : null}

      {state.phase === "ready" && houses.length > 0 && shownView === "map" ? (
        <HouseMap houses={houses} client={client} linkProfiles={canWrite} />
      ) : null}

      {state.phase === "ready" && houses.length > 0 && shownView === "grid" ? (
        <>
          <div className={styles.toolbar} data-testid="house-filters">
            <div className={styles.toggles} role="group" aria-label="Campus">
              <FilterChip on={campus === ""} onClick={() => setCampus("")}>
                All campuses
              </FilterChip>
              {campuses.map((value) => (
                <FilterChip key={value} on={campus === value} onClick={() => setCampus(value)}>
                  {CAMPUS_LABEL[value]}
                </FilterChip>
              ))}
              <FilterChip on={attention} onClick={() => setAttention((open) => !open)}>
                Needs attention
              </FilterChip>
            </div>
            {coaches.length > 0 ? (
              <label className={styles.sort}>
                Coach
                <select value={coach} onChange={(event) => setCoach(event.target.value)}>
                  <option value="">Any coach</option>
                  {coaches.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                  <option value="none">No coach yet</option>
                </select>
              </label>
            ) : null}
            <label className={styles.sort}>
              Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="size">Size, biggest first</option>
                <option value="number">House number</option>
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <div className={shell.state} data-state="empty">
              No houses match those filters.
            </div>
          ) : (
            <ul className={styles.grid} data-testid="house-grid">
              {shown.map((house) => (
                <li key={house.id}>
                  <HouseCard house={house} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`${styles.filterChip} ${on ? styles.filterChipOn : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/** Dots out of HOUSE_SEATS. Anyone past that shows as "+n". */
export function SizeDots({ count }: { count: number }) {
  const safe = Math.max(0, Math.trunc(count));
  const filled = Math.min(safe, HOUSE_SEATS);
  return (
    <span className={styles.dots} aria-hidden="true">
      {Array.from({ length: HOUSE_SEATS }, (_, index) => (
        <span key={index} className={index < filled ? styles.dotOn : styles.dot} />
      ))}
      {safe > HOUSE_SEATS ? <span className={styles.dotMore}>+{safe - HOUSE_SEATS}</span> : null}
    </span>
  );
}

function HouseCard({ house }: { house: HouseSummary }) {
  const title = houseTitle(house);
  const named = Boolean(house.name?.trim());
  const day = shortDay(house.meetingDay);
  const signals = houseSignals(house);
  const leading = [...house.leaders.slice(0, 1), ...house.coLeaders.slice(0, 1)];
  return (
    <Link href={`/missio/house-churches/${encodeURIComponent(house.id)}`} className={styles.houseCard} data-testid="house-card">
      <div className={styles.houseTop}>
        <span className={styles.houseName}>{title}</span>
        <span className={styles.houseMeta}>
          {day ? <span>{day}</span> : null}
          <span className={shell.tag}>{CAMPUS_LABEL[house.campus]}</span>
        </span>
      </div>
      {named ? <p className={styles.number}>House {house.number}</p> : null}
      <div className={styles.size}>
        <span className={styles.sizeCount}>{house.memberCount}</span>
        <span className={styles.sizeLabel}>{peopleCount(house.memberCount).replace(/^\d+\s/, "")}</span>
      </div>
      <SizeDots count={house.memberCount} />
      <div className={styles.leading}>
        {leading.length > 0 ? (
          <span className={styles.faces} aria-hidden="true">
            {leading.map((person) => (
              <span key={person.contactId} className={styles.face}>
                {initialsOf(person.displayName)}
              </span>
            ))}
          </span>
        ) : null}
        <span className={styles.leadingName}>{leadingLine(house)}</span>
      </div>
      {house.location?.trim() ? <p className={styles.place}>{house.location.trim()}</p> : null}
      {house.coaches.length > 0 ? <p className={styles.place}>Coached by {coachNames(house.coaches)}</p> : null}
      {signals.length > 0 ? (
        <div className={styles.signals}>
          {signals.map((signal) => (
            <span key={signal} className={`${styles.signal} ${signal === "ready" ? styles.signalReady : styles.signalWarn}`}>
              {SIGNAL_LABEL[signal]}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
