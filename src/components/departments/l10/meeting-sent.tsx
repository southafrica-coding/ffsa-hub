"use client";

import Link from "next/link";
import { formatAverage, type DmStatus, type RecapStatus, type SentView } from "./followup";
import styles from "./l10.module.css";

function DmMark({ status }: { status: DmStatus }) {
  switch (status) {
    case "sent":
      return <span className={styles.okMark}>Sent ✓</span>;
    case "failed":
      return <span className={styles.failMark}>Not sent</span>;
    case "skipped":
      return <span className={styles.tagQuiet}>Skipped</span>;
    case "unknown":
      return (
        <span className={styles.tagQuiet} title="No result came back">
          No result
        </span>
      );
  }
}

function RecapMark({ status }: { status: RecapStatus }) {
  switch (status) {
    case "posted":
      return <span className={styles.okMark}>Posted ✓</span>;
    case "failed":
      return <span className={styles.failMark}>Not posted</span>;
    case "skipped":
      return <span className={styles.tagQuiet}>No channel</span>;
    case "unknown":
      return <span className={styles.tagQuiet}>No result</span>;
  }
}

export function SentBody({ view, teamHref, teamsHref }: { view: SentView; teamHref: string; teamsHref: string }) {
  const failed = view.people.some((p) => p.status === "failed") || view.recap === "failed";
  const allGood = !failed && view.people.every((p) => p.status === "sent") && view.recap !== "unknown";
  const kept = view.totals.issuesKept;
  return (
    <>
      <p className={`${styles.currentTitle} mt-0`}>{allGood ? "Sent ✓" : view.alreadyEnded ? "Already ended" : "Meeting ended"}</p>
      {failed ? (
        <p className={styles.warn} role="alert">
          Some follow-ups didn&apos;t go out. Everything is saved in the Hub, so tell those people in person or on Slack.
        </p>
      ) : null}

      <div className={styles.groupHead}>
        <span>DMs with to-dos</span>
        <span>{view.people.length}</span>
      </div>
      <ul className={styles.list}>
        {view.people.length === 0 ? <li className={styles.empty}>Nobody has an open to-do.</li> : null}
        {view.people.map((person) => (
          <li key={person.user_id} className={styles.sumRow}>
            <span className="min-w-0">
              <span className="block truncate">{person.name}</span>
              <span className={styles.rowMeta}>
                {person.count} {person.count === 1 ? "to-do" : "to-dos"}
              </span>
            </span>
            <DmMark status={person.status} />
          </li>
        ))}
        <li className={styles.sumRow}>
          <span className="min-w-0">Recap to team channel</span>
          <RecapMark status={view.recap} />
        </li>
      </ul>

      <div className={`${styles.recap} mt-5`}>
        <div className={styles.recapCell}>
          <div className={styles.statNum}>{view.totals.newTodos}</div>
          <div className={styles.statLabel}>New to-dos</div>
        </div>
        <div className={styles.recapCell}>
          <div className={styles.statNum}>{view.totals.issuesSolved}</div>
          <div className={styles.statLabel}>Issues solved</div>
        </div>
        <div className={styles.recapCell}>
          <div className={styles.statNum}>{kept}</div>
          <div className={styles.statLabel}>Issues kept</div>
        </div>
      </div>
      <div className={styles.average}>
        <span className={styles.mono}>Average{view.ratedCount > 0 ? ` · ${view.ratedCount} rated` : ""}</span>
        <span className={styles.sumNum}>{formatAverage(view.average)}</span>
      </div>
      <p className={styles.slackNote}>
        The {kept} kept {kept === 1 ? "issue" : "issues"} and any unfinished to-dos carry over by themselves.
      </p>

      <div className="mt-5 grid gap-2">
        <Link href={teamHref} className={`${styles.btnPrimary} ${styles.btnBlock}`}>
          Back to the team
        </Link>
        <Link href={teamsHref} className={`${styles.btn} ${styles.btnBlock}`}>
          All teams
        </Link>
      </div>
    </>
  );
}
