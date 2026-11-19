"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CAMPUS_LABEL } from "../access";
import type { HouseChurchesClient } from "./client";
import {
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
import { SizeDots } from "./house-grid";
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
    const key = house.coach?.contactId ?? NO_COACH;
    const branch =
      byCoach.get(key) ??
      ({
        key,
        name: house.coach?.displayName || "No coach yet",
        initials: house.coach ? initialsOf(house.coach.displayName) : "?",
        houses: [],
        people: 0,
        attention: 0,
      } satisfies Branch);
    branch.houses.push(house);
    branch.people += Math.max(0, house.memberCount);
    if (houseSignals(house).some((signal) => signal !== "ready" && signal !== "no_coach")) branch.attention += 1;
    byCoach.set(key, branch);
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
 * the open path is terracotta.
 */
export function HouseMap({
  houses,
  client,
}: {
  houses: HouseSummary[];
  client: Pick<HouseChurchesClient, "getHouse">;
}) {
  const branches = useMemo(() => coachBranches(houses), [houses]);
  const [coachKey, setCoachKey] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const open = branches.find((branch) => branch.key === coachKey) ?? null;
  const openHouse = open?.houses.find((house) => house.id === houseId) ?? null;

  return (
    <div className={styles.map} data-testid="house-map">
      <div className={`${styles.root} ${coachKey ? styles.lit : ""}`}>
        <span className={styles.rootMark} aria-hidden="true">
          M
        </span>
        Missio
      </div>
      <span className={`${styles.stem} ${coachKey ? styles.stemLit : ""}`} aria-hidden="true" />

      <ul className={styles.coaches} aria-label="Coaches">
        {branches.map((branch) => {
          const selected = branch.key === coachKey;
          return (
            <li key={branch.key}>
              <button
                type="button"
                className={`${styles.coach} ${selected ? styles.coachOn : ""} ${branch.key === NO_COACH ? styles.coachNone : ""}`}
                aria-expanded={selected}
                onClick={() => {
                  setCoachKey(selected ? null : branch.key);
                  setHouseId(null);
                }}
              >
                <span className={styles.coachFace} aria-hidden="true">
                  {branch.initials}
                  {branch.attention > 0 ? <span className={styles.coachHits}>{branch.attention}</span> : null}
                </span>
                <span className={styles.coachName}>{branch.name}</span>
                <span className={styles.coachMeta}>
                  {branch.houses.length === 1 ? "1 house" : `${branch.houses.length} houses`} · {branch.people}{" "}
                  {branch.people === 1 ? "person" : "people"}
                </span>
                {branch.attention > 0 ? (
                  <span className={styles.visuallyHidden}>
                    , {branch.attention} {branch.attention === 1 ? "house needs" : "houses need"} attention
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {open ? (
        <>
          <span className={`${styles.stem} ${styles.stemLit}`} aria-hidden="true" />
          <ul className={styles.houses} aria-label={`Houses coached by ${open.name}`}>
            {open.houses.map((house) => {
              const selected = house.id === houseId;
              const signal = houseSignals(house).find((item) => item !== "no_coach");
              return (
                <li key={house.id}>
                  <button
                    type="button"
                    className={`${styles.house} ${selected ? styles.houseOn : ""} ${signal && signal !== "ready" ? styles.houseFlag : ""}`}
                    aria-expanded={selected}
                    onClick={() => setHouseId(selected ? null : house.id)}
                  >
                    <span className={styles.houseTop}>
                      <span className={styles.houseName}>{houseTitle(house)}</span>
                      <span className={styles.houseDay}>{shortDay(house.meetingDay)}</span>
                    </span>
                    <span className={styles.houseSize}>
                      <b>{house.memberCount}</b> {house.memberCount === 1 ? "person" : "people"}
                    </span>
                    <SizeDots count={house.memberCount} />
                    <span className={styles.houseLead}>{leadingLine(house)}</span>
                    {signal ? (
                      <span className={`${styles.badge} ${signal === "ready" ? styles.badgeReady : styles.badgeWarn}`}>
                        {SIGNAL_LABEL[signal]}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className={styles.hint}>Choose a coach to see their houses.</p>
      )}

      {open && !openHouse ? <p className={styles.hint}>Choose a house to see its people.</p> : null}
      {openHouse ? (
        <>
          <span className={`${styles.stem} ${styles.stemLit}`} aria-hidden="true" />
          <HouseTray house={openHouse} coachName={open?.key === NO_COACH ? null : open?.name ?? null} client={client} />
        </>
      ) : null}
    </div>
  );
}

function HouseTray({
  house,
  coachName,
  client,
}: {
  house: HouseSummary;
  coachName: string | null;
  client: Pick<HouseChurchesClient, "getHouse">;
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

  return (
    <section className={styles.tray} data-testid="house-tray" aria-label={houseTitle(house)}>
      <div className={styles.trayHead}>
        <div>
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
            {leading.length === 0 ? <p className={styles.hint}>No leader yet</p> : null}
            <ul className={styles.people}>
              {leading.map((member) => (
                <Person key={member.contactId} name={member.displayName} href={personHref(member)} tag={ROLE_LABEL[member.role]} />
              ))}
            </ul>
          </div>
          <div>
            <h3>Members · {rest.length}</h3>
            <ul className={styles.people}>
              {rest.slice(0, 12).map((member) => (
                <Person key={member.contactId} name={member.displayName} href={personHref(member)} />
              ))}
            </ul>
            {rest.length > 12 ? <p className={styles.hint}>+ {rest.length - 12} more</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Person({ name, href, tag }: { name: string; href: string | null; tag?: string }) {
  return (
    <li>
      <span className={styles.face} aria-hidden="true">
        {initialsOf(name)}
      </span>
      {href ? <Link href={href}>{name}</Link> : <span>{name}</span>}
      {tag ? <span className={styles.tag}>{tag}</span> : null}
    </li>
  );
}
