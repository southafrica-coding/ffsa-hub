"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CAMPUS_LABEL } from "../access";
import { missioPublicFeedbackPath } from "@/lib/missio/public-feedback-link";
import { houseChurchesClient, type HouseChurchesClient } from "./client";
import {
  coachNames,
  HOUSE_SEATS,
  SIGNAL_LABEL,
  houseSignals,
  houseTitle,
  initialsOf,
  leadingLine,
  sizeWord,
  shortDay,
} from "./format";
import { useMissioLoad } from "./load";
import { HouseMap } from "./house-map";
import { HouseStatus } from "./status";
import type { HouseCampus, HouseSummary } from "./types";
import type { HouseSignal } from "./format";
import g from "./grid.module.css";
import ui from "./ui.module.css";

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

  const signalCounts = useMemo(() => {
    const counts = new Map<HouseSignal, number>();
    for (const house of houses) for (const signal of houseSignals(house)) counts.set(signal, (counts.get(signal) ?? 0) + 1);
    return SIGNAL_ORDER.filter((signal) => (counts.get(signal) ?? 0) > 0).map((signal) => ({ signal, count: counts.get(signal) ?? 0 }));
  }, [houses]);
  const ready = state.phase === "ready" && houses.length > 0;
  const totals = `${houses.length === 1 ? "1 house" : `${houses.length} houses`} · ${total === 1 ? "1 member" : `${total} members`}${
    coaches.length > 0 ? ` · ${coaches.length === 1 ? "1 coach" : `${coaches.length} coaches`}` : ""
  }`;

  return (
    <div className={`${ui.root} ${g.page} ${ready && shownView === "map" ? g.pageMap : ""}`}>
      <div className={g.head}>
        <div className={g.headText}>
          <h1 className={`${ui.serif} ${g.title}`}>House churches</h1>
          {ready ? (
            <p className={g.totals} data-testid="house-totals">
              {totals}
            </p>
          ) : null}
        </div>
        {ready ? (
          <div className={g.seg} role="group" aria-label="View">
            <button type="button" className={shownView === "map" ? g.segOn : undefined} aria-pressed={shownView === "map"} onClick={() => setView("map")}>
              Map
            </button>
            <button type="button" className={shownView === "grid" ? g.segOn : undefined} aria-pressed={shownView === "grid"} onClick={() => setView("grid")}>
              Grid
            </button>
          </div>
        ) : null}
        {canWrite ? (
          <Link href="/missio/house-churches/review" className={`${ui.btn} ${ui.s} ${g.review}`} data-testid="review-names">
            {reviewCount != null && reviewCount > 0 ? (
              <>
                Review names<span className={g.reviewCount}> ({reviewCount})</span>
              </>
            ) : (
              "Review names"
            )}
          </Link>
        ) : null}
      </div>
      {ready ? (
        <Link href="/missio/house-churches/feedback" className={g.feedbackLink} data-testid="feedback-link">
          Weekly feedback
        </Link>
      ) : null}

      {state.phase === "loading" ? (
        <div className={`${ui.card} ${g.state}`} data-state="loading" role="status">
          Loading house churches…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="House churches didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" && houses.length === 0 ? (
        <div className={`${ui.card} ${g.state}`} data-state="empty">
          No house churches yet.
        </div>
      ) : null}

      {ready && shownView === "map" ? (
        <HouseMap houses={houses} client={client} linkProfiles={canWrite} signals={signalCounts} />
      ) : null}

      {ready && shownView === "grid" ? (
        <>
          <div className={g.filters} data-testid="house-filters">
            <div className={g.chips} role="group" aria-label="Campus">
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
              <label className={g.select}>
                <span>Coach</span>
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
            <label className={`${g.select} ${g.sort}`}>
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="size">Size, biggest first</option>
                <option value="number">House number</option>
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <div className={`${ui.card} ${g.state}`} data-state="empty">
              No houses match those filters.
            </div>
          ) : (
            <ul className={g.grid} data-testid="house-grid">
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

/** The order signals read in, most actionable first (board M3a "Needs you"). */
export const SIGNAL_ORDER: HouseSignal[] = ["ready", "no_leader", "no_co_leader", "no_coach"];

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`${g.fchip} ${on ? g.fchipOn : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The house as dots, out of HOUSE_SEATS (board M3a): leaders dark, everyone
 * else sage, empty seats outlined. Anyone past the seats shows as "+n".
 */
export function SizeDots({ count, leaders = 0 }: { count: number; leaders?: number }) {
  const safe = Math.max(0, Math.trunc(count));
  const filled = Math.min(safe, HOUSE_SEATS);
  const lead = Math.min(Math.max(0, leaders), filled);
  return (
    <span className={g.dots} aria-hidden="true">
      {Array.from({ length: HOUSE_SEATS }, (_, index) => (
        <span key={index} className={`${g.dot} ${index < lead ? g.dotLead : index < filled ? g.dotOn : g.dotEmpty}`} />
      ))}
      {safe > HOUSE_SEATS ? <span className={g.dotMore}>+{safe - HOUSE_SEATS}</span> : null}
    </span>
  );
}

const TINTS = ["a1", "a2", "a3", "a4", "a5"] as const;

export function tintOf(id: string): (typeof TINTS)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

function HouseCard({ house }: { house: HouseSummary }) {
  const title = houseTitle(house);
  const named = Boolean(house.name?.trim());
  const day = shortDay(house.meetingDay);
  const signals = houseSignals(house);
  const leading = [...house.leaders.slice(0, 1), ...house.coLeaders.slice(0, 1)];
  const leaderCount = house.leaders.length + house.coLeaders.length;
  return (
    // Two links side by side, never one inside the other: the card body
    // opens the house, the foot opens this week's form for it.
    <article className={`${ui.card} ${g.card}`} data-testid="house-card-item" aria-label={title}>
      <Link href={`/missio/house-churches/${encodeURIComponent(house.id)}`} className={g.cardMain} data-testid="house-card">
        <span className={g.cardTop}>
          <span className={`${ui.serif} ${g.cardName}`}>{title}</span>
          {day ? <span className={`${ui.mono} ${g.day}`}>{day}</span> : null}
          <span className={`${ui.tag} ${g.cardTag}`}>{CAMPUS_LABEL[house.campus]}</span>
        </span>
        {named || house.location?.trim() ? (
          <span className={g.cardSub}>{[named ? `House ${house.number}` : null, house.location?.trim() || null].filter(Boolean).join(" · ")}</span>
        ) : null}
        <SizeDots count={house.memberCount} leaders={leaderCount} />
        <span className={g.size}>
          <b className={`${ui.num} ${g.sizeCount}`}>{house.memberCount}</b>
          <span className={g.sizeLabel}>{sizeWord(house)}</span>
        </span>
        <span className={g.lead}>
          {leading.length > 0 ? (
            <span className={g.stack} aria-hidden="true">
              {leading.map((person) => (
                <span key={person.contactId} className={`${ui.av} ${ui.avSm} ${ui[tintOf(person.contactId)]}`}>
                  {initialsOf(person.displayName)}
                </span>
              ))}
            </span>
          ) : null}
          <span className={g.leadName}>{leadingLine(house)}</span>
        </span>
        <span className={g.cardFoot}>
          <span className={g.coach}>{house.coaches.length > 0 ? coachNames(house.coaches) : "No coach yet"}</span>
          {signals.length > 0 ? (
            <span className={g.signals}>
              {signals.map((signal) => (
                <span key={signal} className={`${ui.chip} ${g.sigChip} ${signal === "ready" ? ui.cOlive : ui.cGold}`}>
                  {SIGNAL_LABEL[signal]}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </Link>
      <a href={missioPublicFeedbackPath(house.id)} className={`${ui.btn} ${ui.s} ${g.cardFeedback}`} data-testid="house-weekly-feedback">
        Weekly feedback<span className={g.srOnly}> for {title}</span>
      </a>
    </article>
  );
}
