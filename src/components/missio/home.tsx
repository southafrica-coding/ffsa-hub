import Link from "next/link";
import content from "./content.module.css";
import styles from "./shell.module.css";

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
  return (
    <div className={`${content.page} ${content.reveal}`}>
      <p className={`${styles.eyebrow} ${content.eyebrow}`}>{date}</p>
      <h1 className={content.title}>{greeting}</h1>
      <p className={`${styles.lede} ${content.lede}`}>The church workspace.</p>
      <Link href="/missio/people" className={`${styles.card} ${content.card} ${content.solo}`}>
        <div className={`${styles.cardTitle} ${content.cardTitle}`}>People</div>
        <p className={`${styles.cardBody} ${content.cardBody}`}>Names and where someone is in the life of the church.</p>
      </Link>
    </div>
  );
}
