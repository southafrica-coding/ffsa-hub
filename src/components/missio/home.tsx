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
      <p className={`${styles.lede} ${content.lede}`}>
        Potch is the main church. Johannesburg meets as Missio JHB.
      </p>
      <div className={`${styles.grid} ${content.grid}`}>
        <Link href="/missio/people" className={`${styles.card} ${content.card}`}>
          <div className={`${styles.cardTitle} ${content.cardTitle}`}>People</div>
          <p className={`${styles.cardBody} ${content.cardBody}`}>Directory for Missio Potch and Missio JHB.</p>
        </Link>
        <div className={`${styles.card} ${content.card}`}>
          <div className={`${styles.cardTitle} ${content.cardTitle}`}>Potch</div>
          <p className={`${styles.cardBody} ${content.cardBody}`}>
            Main church, Potchefstroom. <span className={`${styles.tagQuiet} ${styles.tag} ${content.tag}`}>Missio Potch</span>
          </p>
        </div>
        <div className={`${styles.card} ${content.card}`}>
          <div className={`${styles.cardTitle} ${content.cardTitle}`}>Johannesburg</div>
          <p className={`${styles.cardBody} ${content.cardBody}`}>
            Johannesburg congregation. <span className={`${styles.tag} ${content.tag}`}>Missio JHB</span>
          </p>
        </div>
      </div>
      <div className={`${styles.grid} ${content.grid}`}>
        <div className={`${styles.card} ${content.card}`}>
          <div className={`${styles.cardTitle} ${content.cardTitle}`}>House churches</div>
          <p className={`${styles.cardBody} ${content.cardBody}`}>No house-church list in this release.</p>
        </div>
        <div className={`${styles.card} ${content.card}`}>
          <div className={`${styles.cardTitle} ${content.cardTitle}`}>Teams</div>
          <p className={`${styles.cardBody} ${content.cardBody}`}>No team list in this release.</p>
        </div>
      </div>
    </div>
  );
}
