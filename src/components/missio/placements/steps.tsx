import type { PlacementView } from "@/lib/missio/placements";
import shell from "../shell.module.css";
import styles from "./placements.module.css";

const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });

export function shortDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? "" : short.format(date);
}

export const STEP_LABEL = {
  placed: "Placed",
  said_hi: "Leader said hi",
  first_visit: "First visit",
  joined: "Joined",
} as const;

/**
 * Placed → Leader said hi → First visit → Joined. The same four steps for pastors, leaders and the person.
 * Drawn as four bars (board M12a/b): green when done, terracotta dashes for the step that's waiting.
 */
export function PlacementSteps({ view, compact = false }: { view: PlacementView; compact?: boolean }) {
  const steps: Array<{ key: keyof typeof STEP_LABEL; at: string | null }> = [
    { key: "placed", at: view.placedAt },
    { key: "said_hi", at: view.saidHiAt },
    { key: "first_visit", at: view.firstVisitAt },
    { key: "joined", at: view.joinedAt },
  ];
  return (
    <ol className={`${styles.steps} ${compact ? styles.stepsCompact : ""}`} aria-label="Where they’re at">
      {steps.map((step) => {
        const done = Boolean(step.at);
        const current = !done && view.next === step.key;
        return (
          <li key={step.key} className={done ? styles.stepDone : current ? styles.stepNow : styles.stepTodo}>
            <span className={styles.bar} aria-hidden="true" />
            <span className={styles.stepLabel}>{STEP_LABEL[step.key]}</span>
            {done && compact ? <span className={styles.stepDate}>{shortDate(step.at)}</span> : null}
            <span className={shell.visuallyHidden}>{done ? ` done ${shortDate(step.at)}` : current ? " next" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
