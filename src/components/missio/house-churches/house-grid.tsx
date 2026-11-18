"use client";

import Link from "next/link";
import { CAMPUS_LABEL } from "../access";
import content from "../content.module.css";
import shell from "../shell.module.css";
import { houseChurchesClient, type HouseChurchesClient } from "./client";
import { houseTitle, meetingLine, nameList, peopleCount, sortHouses } from "./format";
import { useMissioLoad } from "./load";
import { HouseStatus } from "./status";
import styles from "./house-churches.module.css";

export function HouseChurchGrid({ client = houseChurchesClient }: { client?: HouseChurchesClient }) {
  const { state, retry } = useMissioLoad(() => client.listHouses(), [client]);

  return (
    <div className={`${content.page} ${styles.root}`}>
      <p className={`${shell.eyebrow} ${content.eyebrow}`}>Missio houses</p>
      <div className={styles.reviewHead}>
        <h1 className={content.title}>House churches</h1>
      </div>
      <p className={`${shell.lede} ${content.lede}`}>
        Being in a house is membership in this church. A person can be in more than one.
      </p>

      {state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading house churches…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="House churches didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" && state.data.houses.length === 0 ? (
        <div className={shell.state} data-state="empty">
          No house churches yet.
        </div>
      ) : null}
      {state.phase === "ready" && state.data.houses.length > 0 ? (
        <>
          {state.data.canWrite ? (
            <p className={styles.line}>
              <Link href="/missio/house-churches/review" className={styles.personLink}>
                Review names
              </Link>
            </p>
          ) : null}
          <ul className={styles.grid} data-testid="house-grid">
            {sortHouses(state.data.houses).map((house) => {
              const title = houseTitle(house);
              const named = Boolean(house.name?.trim());
              const meets = meetingLine(house);
              return (
                <li key={house.id}>
                  <Link
                    href={`/missio/house-churches/${encodeURIComponent(house.id)}`}
                    className={`${shell.card} ${content.card} ${styles.card}`}
                    data-testid="house-card"
                  >
                    <div className={styles.top}>
                      <div className={`${shell.cardTitle} ${content.cardTitle}`}>{title}</div>
                      <div className={styles.count}>{peopleCount(house.memberCount)}</div>
                    </div>
                    {named ? <p className={styles.number}>House {house.number}</p> : null}
                    <p className={styles.line}>
                      <span className={shell.campus}>{CAMPUS_LABEL[house.campus]}</span>
                      {house.campus === "potch" ? <span className={shell.campusMain}>Main</span> : null}
                    </p>
                    <p className={styles.line}>Leaders: {nameList(house.leaders)}</p>
                    <p className={styles.line}>Co-leaders: {nameList(house.coLeaders)}</p>
                    {meets ? <p className={styles.line}>{meets}</p> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
