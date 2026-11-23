"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CAMPUS_LABEL } from "../access";
import type { HouseChurchesClient } from "./client";
import {
  coachNames,
  houseSignals,
  houseTitle,
  initialsOf,
  leadingLine,
  meetingDayLabel,
  personHref,
  ROLE_LABEL,
  SIGNAL_LABEL,
  shortDay,
  sortMembers,
} from "./format";
import { SizeDots, tintOf } from "./house-grid";
import type { HouseSignal } from "./format";
import type { HouseDetail, HouseSummary } from "./types";
import styles from "./house-map.module.css";

const NO_COACH = "none";

type Branch = {
  key: string;
  name: string;
  initials: string;
  houses: HouseSummary[];
  people: number;
  attention: number;
};

/** Coaches with their houses, biggest load first. Houses with no coach form their own branch, last. */
export function coachBranches(houses: HouseSummary[]): Branch[] {
  const byCoach = new Map<string, Branch>();
  for (const house of houses) {
    // A house with several coaches sits under each of them.
    const owners = house.coaches.length > 0 ? house.coaches : [null];
    for (const owner of owners) {
      const key = owner?.contactId ?? NO_COACH;
      const branch =
        byCoach.get(key) ??
        ({
          key,
          name: owner?.displayName || "No coach yet",
          initials: owner ? initialsOf(owner.displayName) : "?",
          houses: [],
          people: 0,
          attention: 0,
        } satisfies Branch);
      branch.houses.push(house);
      branch.people += Math.max(0, house.memberCount);
      if (houseSignals(house).some((signal) => signal !== "ready" && signal !== "no_coach")) branch.attention += 1;
      byCoach.set(key, branch);
    }
  }
  const list = [...byCoach.values()];
  for (const branch of list) branch.houses.sort((a, b) => b.memberCount - a.memberCount || a.number - b.number);
  return list.sort((a, b) => {
    if (a.key === NO_COACH) return 1;
    if (b.key === NO_COACH) return -1;
    return b.houses.length - a.houses.length || a.name.localeCompare(b.name, "en");
  });
}

/**
 * The map (boards M3a, M3b): Missio at the top, then coaches, then a
 * coach's houses, then the people in a house. One branch open at a time;
 * the open path is terracotta. The "Needs you" signals light the houses
 * (and the coaches over them) that carry that signal.
 */
export function HouseMap({
  houses,
  client,
  linkProfiles = true,
  signals = [],
}: {
  houses: HouseSummary[];
  client: Pick<HouseChurchesClient, "getHouse">;
  /** Profiles are pastors only for now. */
  linkProfiles?: boolean;
  /** Signal counts across every house, most actionable first. */
  signals?: { signal: HouseSignal; count: number }[];
}) {
  const branches = useMemo(() => coachBranches(houses), [houses]);
  // Board M3b opens with one coach open, so houses show without a tap:
  // the coach with the most houses (the first branch).
  const [coachKey, setCoachKey] = useState<string | null>(() => branches[0]?.key ?? null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [lit, setLit] = useState<HouseSignal | null>(null);
  const open = branches.find((branch) => branch.key === coachKey) ?? null;
  const people = houses.reduce((sum, house) => sum + Math.max(0, house.memberCount), 0);
  const hits = (house: HouseSummary) => lit != null && houseSignals(house).includes(lit);

  return (
    <div className={styles.wrap}>
      {signals.length > 0 ? (
        <div className={styles.signals} role="group" aria-label="Needs you">
          <span className={styles.signalsLabel}>Needs you</span>
          {signals.map(({ signal, count }) => {
            const on = lit === signal;
            return (
              <button
                key={signal}
                type="button"
                className={`${styles.sg} ${on ? styles.sgOn : ""}`}
                aria-pressed={on}
                onClick={() => setLit(on ? null : signal)}
              >
                <span className={styles.sgn}>{count}</span>
                {SIGNAL_LABEL[signal]}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={styles.map} data-testid="house-map">
        <div className={styles.rootRow}>
          <div className={styles.root}>
            <Image src="/brands/missio/missio-wordmark-paper.png" alt="Missio" width={677} height={188} className={styles.wordmark} />
            <span className={styles.rootMeta}>
              {houses.length === 1 ? "1 house" : `${houses.length} houses`} · {people} {people === 1 ? "person" : "people"}
            </span>
          </div>
        </div>
        <span className={`${styles.stem} ${coachKey ? styles.stemLit : ""}`} aria-hidden="true" />

        <ul className={styles.coaches} aria-label="Coaches">
          {branches.map((branch) => {
            const selected = branch.key === coachKey;
            const hitCount = lit ? branch.houses.filter(hits).length : 0;
            return (
              <li key={branch.key}>
                <button
                  type="button"
                  className={`${styles.coach} ${selected ? styles.coachOn : ""} ${branch.key === NO_COACH ? styles.coachNone : ""} ${
                    lit && hitCount === 0 ? styles.dim : ""
                  }`}
                  aria-expanded={selected}
                  onClick={() => {
                    setCoachKey(selected ? null : branch.key);
                    setHouseId(null);
                  }}
                >
                  <span className={`${styles.cav} ${branch.key === NO_COACH ? "" : styles[tintOf(branch.key)]}`} aria-hidden="true">
                    {branch.initials}
                    {hitCount > 0 ? <span className={styles.hitn}>{hitCount}</span> : null}
                  </span>
                  <span className={styles.coachName}>{branch.name}</span>
                  <span className={styles.coachMeta}>
                    {branch.houses.length === 1 ? "1 house" : `${branch.houses.length} houses`}
                    <span className={styles.coachPeople}>
                      {" "}
                      · {branch.people} {branch.people === 1 ? "person" : "people"}
                    </span>
                  </span>
                  {hitCount > 0 ? (
                    <span className={styles.visuallyHidden}>
                      , {hitCount} {hitCount === 1 ? "house" : "houses"} with {SIGNAL_LABEL[lit!].toLowerCase()}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {open ? (
          <>
            <span className={styles.drop} aria-hidden="true">
              <span className={styles.joint} />
            </span>
            <ul className={styles.houses} aria-label={`Houses coached by ${open.name}`}>
              {open.houses.map((house) => {
                const selected = house.id === houseId;
                const signal = houseSignals(house).find((item) => item !== "no_coach");
                const leaders = house.leaders.length + house.coLeaders.length;
                return (
                  <li key={house.id} className={`${styles.houseItem} ${selected ? styles.houseItemOpen : ""}`}>
                    <button
                      type="button"
                      className={`${styles.house} ${selected ? styles.houseOn : ""} ${hits(house) ? styles.houseHit : ""} ${
                        lit && !hits(house) ? styles.dim : ""
                      }`}
                      aria-expanded={selected}
                      onClick={() => setHouseId(selected ? null : house.id)}
                    >
                      <span className={styles.houseTop}>
                        <span className={styles.houseName}>{houseTitle(house)}</span>
                        <span className={styles.houseDay}>{shortDay(house.meetingDay)}</span>
                        <span className={styles.houseSize}>
                          <b>{house.memberCount}</b> {house.memberCount === 1 ? "person" : "people"}
                        </span>
                      </span>
                      <SizeDots count={house.memberCount} leaders={leaders} />
                      <span className={styles.houseFoot}>
                        <span className={styles.houseLead}>{leadingLine(house)}</span>
                        {signal ? (
                          <span className={`${styles.badge} ${signal === "ready" ? styles.badgeReady : styles.badgeWarn}`}>
                            {SIGNAL_LABEL[signal]}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {selected ? (
                      <HouseTray
                        house={house}
                        coachName={house.coaches.length > 0 ? coachNames(house.coaches) : null}
                        client={client}
                        linkProfiles={linkProfiles}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {!houseId ? <p className={styles.hint}>Choose a house to see its people.</p> : null}
          </>
        ) : (
          <p className={styles.hint}>Choose a coach to see their houses.</p>
        )}
      </div>
    </div>
  );
}

function HouseTray({
  house,
  coachName,
  client,
  linkProfiles,
}: {
  house: HouseSummary;
  coachName: string | null;
  client: Pick<HouseChurchesClient, "getHouse">;
  linkProfiles: boolean;
}) {
  const [detail, setDetail] = useState<HouseDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setFailed(false);
    client.getHouse(house.id).then(
      (page) => {
        if (live) setDetail(page.house);
      },
      () => {
        if (live) setFailed(true);
      }
    );
    return () => {
      live = false;
    };
  }, [client, house.id]);

  const members = detail ? sortMembers(detail.members) : [];
  const leading = members.filter((member) => member.role !== "member");
  const rest = members.filter((member) => member.role === "member");
  const day = meetingDayLabel(house.meetingDay);
  const line = [day ? `${day}s` : null, coachName ? `coached by ${coachName}` : "no coach yet", CAMPUS_LABEL[house.campus]]
    .filter(Boolean)
    .join(" · ");
  const SHOWN = 12;

  return (
    <section className={styles.tray} data-testid="house-tray" aria-label={houseTitle(house)}>
      <div className={styles.trayHead}>
        <div className={styles.trayTitle}>
          <h2>{houseTitle(house)}</h2>
          <p className={styles.trayLine}>{line}</p>
        </div>
        <Link href={`/missio/house-churches/${encodeURIComponent(house.id)}`} className={styles.open}>
          Open house
        </Link>
      </div>
      {failed ? <p className={styles.hint}>This house’s people didn’t load.</p> : null}
      {!detail && !failed ? <p className={styles.hint}>Loading people…</p> : null}
      {detail ? (
        <div className={styles.trayCols}>
          <div>
            <h3>Leading</h3>
            {leading.length === 0 ? <p className={styles.trayEmpty}>No leader yet</p> : null}
            <ul className={styles.people}>
              {leading.map((member) => (
                <Person
                  key={member.contactId}
                  id={member.contactId}
                  name={member.displayName}
                  href={linkProfiles ? personHref(member) : null}
                  tag={ROLE_LABEL[member.role]}
                  lead
                />
              ))}
            </ul>
          </div>
          <div>
            <h3>Members · {rest.length}</h3>
            <ul className={styles.people}>
              {rest.slice(0, SHOWN).map((member) => (
                <Person
                  key={member.contactId}
                  id={member.contactId}
                  name={member.displayName}
                  href={linkProfiles ? personHref(member) : null}
                />
              ))}
              {rest.length > SHOWN ? (
                <li>
                  <Link href={`/missio/house-churches/${encodeURIComponent(house.id)}`} className={styles.more}>
                    + {rest.length - SHOWN} more
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Person({ id, name, href, tag, lead = false }: { id: string; name: string; href: string | null; tag?: string; lead?: boolean }) {
  const body = (
    <>
      <span className={`${styles.face} ${lead ? "" : styles[tintOf(id)]}`} aria-hidden="true">
        {initialsOf(name)}
      </span>
      <span className={styles.personName}>{name}</span>
      {tag ? <span className={styles.visuallyHidden}>, {tag}</span> : null}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={`${styles.person} ${lead ? styles.personLead : ""}`}>
          {body}
        </Link>
      ) : (
        <span className={`${styles.person} ${lead ? styles.personLead : ""}`}>{body}</span>
      )}
    </li>
  );
}
