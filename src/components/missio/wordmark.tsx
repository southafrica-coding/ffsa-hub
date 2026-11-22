import styles from "./wordmark.module.css";

/**
 * MISSIŌ + SA, set in DM Sans 700 as the Brand Guide draws it. SA takes
 * `--sa`: sun on paper, lime on ink. Never lime SA on a light ground.
 */
export function MissioWordmark({ className = "", size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`${styles.mark} ${styles[size]} ${className}`} role="img" aria-label="MissioSA" data-missio-wordmark="">
      <span aria-hidden>MISSIŌ</span>
      <span className={styles.sa} aria-hidden>
        SA
      </span>
    </span>
  );
}
