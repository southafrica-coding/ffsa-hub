"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import content from "../content.module.css";
import shell from "../shell.module.css";
import { houseChurchesClient, type HouseChurchesClient } from "./client";
import { houseTitle, peopleCount, sortHouses } from "./format";
import { useMissioLoad } from "./load";
import { CampusTag, MeetingMeta, RoleBlock } from "./present";
import { HouseStatus } from "./status";
import styles from "./house-churches.module.css";

export function HouseChurchGrid({ client = houseChurchesClient }: { client?: HouseChurchesClient }) {
  const { state, retry } = useMissioLoad(() => client.listHouses(), [client]);
  const canWrite = state.phase === "ready" && state.data.canWrite;
  const [reviewCount, setReviewCount] = useState<number | null>(null);

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
            <Link href="/missio/house-churches/review" className={`${shell.ghost} ${styles.reviewButton}`} data-testid="review-names">
              {reviewCount != null && reviewCount > 0 ? `Review names (${reviewCount})` : "Review names"}
            </Link>
          ) : null}
          <ul className={styles.grid} data-testid="house-grid">
            {sortHouses(state.data.houses).map((house) => {
              const title = houseTitle(house);
              const named = Boolean(house.name?.trim());
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
                      <CampusTag campus={house.campus} />
                    </p>
                    <RoleBlock label="Leaders" people={house.leaders} />
                    <RoleBlock label="Co-leaders" people={house.coLeaders} />
                    <MeetingMeta day={house.meetingDay} place={house.location} />
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
