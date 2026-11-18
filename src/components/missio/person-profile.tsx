"use client";

import Link from "next/link";
import { useState } from "react";
import type { JourneyEvent, PersonProfile, ProfileHouse } from "@/lib/missio/profile";
import { CAMPUS_LABEL, STATUS_LABEL } from "./access";
import { fetchPersonProfile } from "./api";
import content from "./content.module.css";
import { houseTitle, ROLE_LABEL } from "./house-churches/format";
import { useMissioLoad } from "./house-churches/load";
import { HouseStatus } from "./house-churches/status";
import shell from "./shell.module.css";
import styles from "./person-profile.module.css";

type Filter = "all" | "houses" | "follow_up";

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "houses", label: "Houses" },
  { id: "follow_up", label: "Follow-up" },
];

const VISIT_LABEL = { first_time: "First time", been_a_while: "Been a while", regular: "Regular" } as const;

const dayFormat = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric", timeZone: "UTC" });

function asDate(value: string): Date | null {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function journeyDate(value: string): string {
  const date = asDate(value);
  return date ? dayFormat.format(date) : "";
}

function since(value: string): string {
  const date = asDate(value);
  return date ? monthFormat.format(date) : "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function inFilter(event: JourneyEvent, filter: Filter): boolean {
  if (filter === "all") return true;
  const house = event.type === "joined_house" || event.type === "left_house";
  if (filter === "houses") return house;
  return !house && event.type !== "added";
}

/** The headline and the quiet line for one journey step. */
export function journeyCopy(event: JourneyEvent): { title: string; detail: string | null; houseId?: string } {
  switch (event.type) {
    case "added":
      return { title: "Added to Missio", detail: null };
    case "joined_house": {
      const title = event.role === "member" ? "Joined" : `Became ${ROLE_LABEL[event.role].toLowerCase()} of`;
      return { title: `${title} ${houseTitle(event)}`, detail: null, houseId: event.houseId };
    }
    case "left_house":
      return { title: `Left ${houseTitle(event)}`, detail: null, houseId: event.houseId };
    case "followup_stage":
      if (event.stage === "contacted") return { title: "Contacted", detail: "Follow-up" };
      if (event.stage === "visited_house") return { title: "Visited a house church", detail: "Follow-up" };
      if (event.stage === "joined") return { title: "Follow-up closed", detail: "Joined a house church" };
      return { title: "Follow-up opened", detail: null };
    case "followup_note":
      return { title: "Follow-up note", detail: event.note };
    case "connect_card": {
      const parts: string[] = [];
      if (event.visitType) parts.push(VISIT_LABEL[event.visitType]);
      if (event.wantsHouseChurch) parts.push("would like a house church");
      if (event.wantsPrayer) parts.push("asked for prayer");
      return { title: "Filled in a connect card", detail: parts.length > 0 ? parts.join(" · ") : null };
    }
  }
}

export function PersonProfileView({
  personId,
  load = fetchPersonProfile,
}: {
  personId: string;
  load?: (id: string) => Promise<PersonProfile>;
}) {
  const { state, retry } = useMissioLoad(() => load(personId), [personId, load]);
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <div className={`${content.page} ${styles.root}`}>
      <Link href="/missio/people" className={styles.back}>
        <span aria-hidden="true">←</span> People
      </Link>
      {state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading person…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="This person didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" ? <Profile profile={state.data} filter={filter} onFilter={setFilter} /> : null}
    </div>
  );
}

function Profile({
  profile,
  filter,
  onFilter,
}: {
  profile: PersonProfile;
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const { person, contact, houses, journey } = profile;
  const current = houses.filter((house) => !house.endedAt);
  const past = houses.filter((house) => house.endedAt);
  const shown = journey.filter((event) => inFilter(event, filter));

  return (
    <>
      <header className={styles.head} data-testid="profile-head">
        <span className={styles.avatar} aria-hidden="true">
          {initials(person.name)}
        </span>
        <div className={styles.headText}>
          <h1 className={`${content.title} ${styles.name}`}>{person.name || "No name"}</h1>
          <p className={styles.tags}>
            <span className={shell.tag} data-status={person.status}>
              {STATUS_LABEL[person.status]}
            </span>
            <span className={shell.tag}>{CAMPUS_LABEL[person.campus]}</span>
          </p>
        </div>
      </header>

      <section className={styles.card} data-testid="profile-belongs">
        <h2>Belongs to</h2>
        {current.length === 0 ? (
          <p className={styles.quiet}>Not in a house church yet.</p>
        ) : (
          <ul className={styles.rows}>
            {current.map((house) => (
              <HouseRow key={house.membershipId} house={house} />
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <>
            <h3>Before</h3>
            <ul className={styles.rows}>
              {past.map((house) => (
                <HouseRow key={house.membershipId} house={house} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className={styles.card} data-testid="profile-contact">
        <h2>Details</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Phone</dt>
            <dd>{contact.phone ?? "Not on file"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{contact.email ?? "Not on file"}</dd>
          </div>
          <div>
            <dt>Campus</dt>
            <dd>{CAMPUS_LABEL[person.campus]}</dd>
          </div>
          {person.joinedAt ? (
            <div>
              <dt>Joined</dt>
              <dd>{journeyDate(person.joinedAt)}</dd>
            </div>
          ) : null}
        </dl>
        <p className={styles.quiet}>Phone and email are partly hidden here.</p>
      </section>

      <section className={styles.journey} data-testid="profile-journey">
        <div className={styles.journeyHead}>
          <h2>Journey</h2>
          <div className={styles.filters} role="group" aria-label="Show">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`${styles.filter} ${filter === option.id ? styles.filterOn : ""}`}
                aria-pressed={filter === option.id}
                onClick={() => onFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className={styles.quiet}>{journey.length === 0 ? "Nothing recorded yet." : "Nothing of that kind yet."}</p>
        ) : (
          <ol className={styles.timeline}>
            {shown.map((event) => {
              const copy = journeyCopy(event);
              return (
                <li key={event.id} className={styles.step} data-type={event.type}>
                  <div className={styles.stepBody}>
                    <p className={styles.stepTitle}>
                      {copy.houseId ? <Link href={`/missio/house-churches/${copy.houseId}`}>{copy.title}</Link> : copy.title}
                    </p>
                    {copy.detail ? <p className={styles.stepDetail}>{copy.detail}</p> : null}
                  </div>
                  <time className={styles.stepDate} dateTime={event.at}>
                    {journeyDate(event.at)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

function HouseRow({ house }: { house: ProfileHouse }) {
  const when = house.endedAt
    ? `${since(house.startedAt)} to ${since(house.endedAt)}`
    : `Since ${since(house.startedAt)}`;
  return (
    <li>
      <Link href={`/missio/house-churches/${house.houseId}`} className={styles.row}>
        <span className={styles.rowMain}>
          {houseTitle(house)} · {ROLE_LABEL[house.role]}
        </span>
        <span className={styles.rowMeta}>{when}</span>
      </Link>
    </li>
  );
}
