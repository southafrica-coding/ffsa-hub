import { Calendar } from "lucide-react";
import content from "./content.module.css";
import styles from "./sundays.module.css";

/**
 * The Sundays tab (boards M11a, M9). The run sheet comes from Planning Center,
 * which isn't linked to the Hub yet, so this is the board's empty state and
 * nothing more: no plan, no team, no times.
 */
export function MissioSundays() {
  return (
    <div className={`${content.page} ${styles.empty}`} data-testid="missio-sundays">
      <div className={styles.slots} aria-hidden="true">
        <span />
        <span>
          <Calendar />
        </span>
        <span />
      </div>
      <h1 className={styles.title}>Sundays aren’t linked yet</h1>
      <p className={styles.text}>
        Sundays will show the Planning Center run sheet here: the next services, who’s serving and the plan notes.
      </p>
      <p className={styles.text}>Planning Center isn’t connected to the Hub yet, so there’s nothing to show.</p>
    </div>
  );
}
