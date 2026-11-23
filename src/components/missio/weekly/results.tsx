"use client";

import { useState } from "react";
import { andList, type SundayResults } from "@/lib/missio/sunday-results";
import { GuideSurface, meetingLabel } from "./surface";
import styles from "./guide.module.css";

// ============================================================
// Sunday results (F4, Missio design) — pastors and coaches
// ============================================================
// Matches the approved mockup (results.html): the missing houses on
// a lime strip with the nudge, eight totals, what needs a coach,
// highlights, then every house.
//
// "Send nudge" is gated twice. With the nudge off (the default) the
// button sends nothing and makes no request: it says it is off. The
// server route refuses on its own too (api/missio/feedback/nudge).
// ============================================================

export type NudgeState = { enabled: boolean; endpoint: string };

type NudgeReply = { status: string; sent?: number };

export function SundayResultsView({
  results,
  nudge,
  navHref,
  sendNudge,
}: {
  results: SundayResults;
  nudge: NudgeState;
  /** Top-bar link to the weekly feedback history (M4b). */
  navHref?: string | null;
  /** Tests: stands in for the POST. */
  sendNudge?: () => Promise<NudgeReply>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const when = meetingLabel(results.sunday);
  const toGo = results.total - results.sentCount;

  async function onNudge() {
    if (!nudge.enabled) {
      setNote("Nudges are switched off for now, so nothing was sent.");
      return;
    }
    setBusy(true);
    try {
      const reply = sendNudge
        ? await sendNudge()
        : ((await fetch(nudge.endpoint, { method: "POST", headers: { accept: "application/json" } }).then((r) => r.json())) as NudgeReply);
      if (reply.status === "done") {
        setNote(reply.sent ? `Sent to ${reply.sent} ${reply.sent === 1 ? "leader" : "leaders"}.` : "Everyone who could be nudged already was.");
      } else {
        setNote("Nothing was sent. Nudges are off.");
      }
    } catch {
      setNote("That didn’t send. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GuideSurface nav={navHref ? { label: "Weekly feedback", href: navHref } : null} state="results">
      <main>
        <div className={styles.intro}>
          <p className={`${styles.eyebrow} ${styles.nums}`}>
            {when.day} · {when.date}
          </p>
          <h1 className={styles.h1}>
            This <em>{when.day === "Sunday" ? "Sunday." : "week."}</em>
          </h1>
          <p className={`${styles.lede} ${styles.nums}`}>
            {results.total === 0
              ? "No houses to show yet."
              : `${results.sentCount} of ${results.total} ${results.total === 1 ? "house has" : "houses have"} sent feedback. Totals only include houses that have sent.`}
          </p>
        </div>

        {results.missing.length > 0 ? (
          <section className={styles.strip} aria-label="Still to send">
            <span className={`${styles.tag} ${styles.nums}`}>{results.missing.length} missing</span>
            <h2>
              {results.missing.length === 1 ? "House" : "Houses"} {andList(results.missing)}.
            </h2>
            <p>One private message to each leader, not a public channel. The same idea as a vehicle digest.</p>
            <button type="button" className={styles.go} onClick={() => void onNudge()} disabled={busy} data-nudge={nudge.enabled ? "on" : "off"}>
              {busy ? "Sending…" : "Send nudge"}
            </button>
            {note ? (
              <p className={styles.note} role="status">
                {note}
              </p>
            ) : null}
          </section>
        ) : null}

        {[results.kpis.slice(0, 4), results.kpis.slice(4, 8)].map((row, i) => (
          <dl className={styles.kpis} key={i}>
            {row.map((k) => (
              <div className={styles.kpiCell} key={k.key}>
                <dt>{k.label}</dt>
                <dd>{k.value}</dd>
              </div>
            ))}
          </dl>
        ))}

        <section aria-labelledby="sr-coach">
          <h2 className={styles.sect} id="sr-coach">
            <span className={styles.sectN}>Needs a coach</span>
          </h2>
          {results.flags.length === 0 ? (
            <p className={styles.empty}>Nothing needs a coach from the houses that have sent.</p>
          ) : (
            <ul className={styles.list}>
              {results.flags.map((f, i) => (
                <li className={styles.flag} key={`${f.kind}-${i}`}>
                  <div className={styles.who}>{f.who}</div>
                  <div className={styles.flagK}>{f.title}</div>
                  <div className={styles.flagS}>{f.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="sr-highlights">
          <h2 className={styles.sect} id="sr-highlights">
            <span className={styles.sectN}>Highlights</span>
          </h2>
          {results.highlights.length === 0 ? (
            <p className={styles.empty}>Wins and testimonies show here as houses send.</p>
          ) : (
            <div className={styles.pad}>
              {results.highlights.map((h, i) => (
                <p className={styles.highlight} key={`${h.houseNumber}-${h.kind}-${i}`}>
                  <b>{h.lead}</b> {h.text}
                </p>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="sr-houses">
          <h2 className={styles.sect} id="sr-houses">
            <span className={styles.sectN}>Houses</span>
            <span className={`${styles.sectN} ${styles.nums}`}>
              {results.sentCount} sent · {toGo} to go
            </span>
          </h2>
          <ul className={styles.list}>
            {results.houses.map((h) => (
              <li className={styles.house} key={h.id} data-state={h.state}>
                <div className={styles.houseNum}>{h.number}</div>
                <div className={styles.grow}>
                  <div className={styles.houseK}>
                    House {h.number}
                    {h.name ? ` · ${h.name}` : ""}
                  </div>
                  <div className={`${styles.houseS} ${styles.nums}`}>{h.summary}</div>
                </div>
                <span className={`${styles.state} ${h.state === "sent" ? "" : styles.stateHot}`}>
                  {h.state === "sent" ? "Sent" : h.state === "missing" ? "Missing" : "Flagged"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <p className={styles.foot}>Missio · House churches · Presence · Formation · Mission · Multiplication</p>
      </main>
    </GuideSurface>
  );
}
