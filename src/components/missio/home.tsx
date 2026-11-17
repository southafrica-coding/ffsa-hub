import Link from "next/link";
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
    <div>
      <p className={styles.eyebrow}>{date}</p>
      <h1>{greeting}</h1>
      <p className={styles.lede}>
        This is Missio’s own workspace. The people here are Missio people. Potch is the main church, and Johannesburg meets as Missio JHB.
      </p>
      <div className={styles.grid}>
        <Link href="/missio/people" className={styles.card}>
          <div className={styles.cardTitle}>People</div>
          <p className={styles.cardBody}>Names, campus and where someone is in the life of the church.</p>
        </Link>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Potch</div>
          <p className={styles.cardBody}>
            The main church. <span className={styles.tagQuiet + " " + styles.tag}>Missio Potch</span>
          </p>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Johannesburg</div>
          <p className={styles.cardBody}>
            Shown with the campus tag. <span className={styles.tag}>Missio JHB</span>
          </p>
        </div>
      </div>
      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>House churches</div>
          <p className={styles.cardBody}>Coming soon.</p>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Teams</div>
          <p className={styles.cardBody}>Coming soon.</p>
        </div>
      </div>
    </div>
  );
}
