import Image from "next/image";
import styles from "./public-mark.module.css";

/** Public Missio pages show only the wordmark, centred (boards M1c, M5a, M6a, M12b). */
export function MissioPublicMark() {
  return (
    <div className={styles.bar}>
      <Image src="/brands/missio/missio-wordmark.png" alt="Missio" width={677} height={188} className={styles.mark} priority />
    </div>
  );
}
