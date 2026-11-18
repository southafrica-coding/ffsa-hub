"use client";

import Link from "next/link";
import { canAccessMissio } from "./access";
import content from "./content.module.css";
import styles from "./shell.module.css";
import { useMissioViewer } from "./viewer";

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

export function MissioHome() {
  const { greeting, date } = johannesburgNow();
  const viewer = useMissioViewer();
  const showHouses = viewer != null && canAccessMissio(viewer);
  const people = (
    <Link href="/missio/people" className={`${styles.card} ${content.card}`} data-testid="home-people">
      <div className={`${styles.cardTitle} ${content.cardTitle}`}>People</div>
      <p className={`${styles.cardBody} ${content.cardBody}`}>Names and where someone is in the life of the church.</p>
    </Link>
  );
  const houses = (
    <Link href="/missio/house-churches" className={`${styles.card} ${content.card}`} data-testid="home-houses">
      <div className={`${styles.cardTitle} ${content.cardTitle}`}>House churches</div>
      <p className={`${styles.cardBody} ${content.cardBody}`}>The house someone belongs to. That is membership in this church.</p>
    </Link>
  );

  return (
    <div className={`${content.page} ${content.reveal}`}>
      <p className={`${styles.eyebrow} ${content.eyebrow}`}>{date}</p>
      <h1 className={content.title}>{greeting}</h1>
      {showHouses ? (
        <div className={content.pair}>
          {people}
          {houses}
        </div>
      ) : (
        <div className={content.solo}>{people}</div>
      )}
    </div>
  );
}
