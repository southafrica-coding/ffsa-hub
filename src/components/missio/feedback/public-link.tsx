"use client";

import { useEffect, useState } from "react";
import {
  MISSIO_PUBLIC_FEEDBACK_PATH,
  missioPublicFeedbackUrl,
  missioPublicFeedbackWhatsApp,
} from "@/lib/missio/public-feedback-link";
import ui from "../house-churches/ui.module.css";
import styles from "./history.module.css";

/**
 * The one public weekly feedback link (Jack, 23 Nov 2026): anyone opens it,
 * picks their house church, and fills the form in. Copy it or send it on
 * WhatsApp. Used on Weekly feedback, the Feedback form editor and (compact)
 * the house page.
 */
export function PublicFeedbackLink({ compact = false, origin }: { compact?: boolean; origin?: string }) {
  const [here, setHere] = useState(origin ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!origin && typeof window !== "undefined") setHere(window.location.origin);
  }, [origin]);
  const url = here ? missioPublicFeedbackUrl(here) : MISSIO_PUBLIC_FEEDBACK_PATH;

  async function copy() {
    setNotice(null);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setNotice("Link copied. Leaders pick their house church when they open it.");
    } catch {
      setNotice("Copy didn’t work here. Press and hold the link above to copy it.");
    }
  }

  return (
    <section
      className={compact ? `${ui.root} ${styles.publicCompact}` : `${ui.root} ${ui.card} ${styles.publicLink}`}
      aria-labelledby={compact ? undefined : "public-feedback-link-title"}
      data-testid="public-feedback-link"
    >
      {compact ? null : (
        <>
          <h2 className={styles.publicTitle} id="public-feedback-link-title">
            One link for every house church
          </h2>
          <p className={styles.quiet}>
            No login. Leaders open it, choose their house church, and fill in the week. Answers land on that house.
          </p>
          <p className={`${ui.mono} ${styles.publicUrl}`} data-testid="public-feedback-url">
            {url}
          </p>
        </>
      )}
      <div className={styles.linkRow}>
        <button
          type="button"
          className={`${ui.btn} ${compact ? ui.s : ui.p} ${styles.publicBtn}`}
          onClick={() => void copy()}
          data-testid="public-feedback-copy"
        >
          Copy public link
        </button>
        <a
          className={`${ui.btn} ${ui.s} ${styles.publicBtn}`}
          href={missioPublicFeedbackWhatsApp(url)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="public-feedback-whatsapp"
        >
          Send on WhatsApp
        </a>
      </div>
      {notice ? (
        <p className={styles.quiet} role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
