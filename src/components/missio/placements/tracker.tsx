"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlacementView } from "@/lib/missio/placements";
import content from "../content.module.css";
import { whatsAppHref } from "../follow-up/whatsapp";
import { useMissioLoad } from "../house-churches/load";
import { HouseStatus } from "../house-churches/status";
import shell from "../shell.module.css";
import { placementsClient, type PlacementsClient } from "./client";
import { placementMessages } from "./messages";
import { PlacementSteps, shortDate } from "./steps";
import styles from "./placements.module.css";

const NEXT_ACTION = { said_hi: "Leader said hi", first_visit: "They came", joined: "Mark joined" } as const;

function houseTitle(house: PlacementView["house"]): string {
  return house.name?.trim() || `House ${house.number}`;
}

/** Board M12a, settling in: everyone placed in the last six weeks, and anyone still open. */
export function PlacementTracker({ client = placementsClient }: { client?: PlacementsClient }) {
  const { state, retry } = useMissioLoad(() => client.list(), [client]);
  const [rows, setRows] = useState<PlacementView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const list = rows ?? (state.phase === "ready" ? state.data.placements : []);
  const settling = list.filter((row) => !row.joinedAt && !row.cancelledAt).length;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function step(row: PlacementView, next: "said_hi" | "first_visit" | "joined" | "cancel") {
    setBusy(row.id);
    setNotice(null);
    try {
      const fresh = await client.step(row.id, next);
      setRows(list.map((item) => (item.id === row.id ? fresh : item)));
    } catch {
      setNotice("That didn’t save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${content.page} ${styles.tracker}`}>
      <Link href="/missio/follow-up" className={styles.backLink}>
        ← Follow-up
      </Link>
      <h1 className={`${content.title} ${styles.trackerTitle}`}>Placements</h1>
      {state.phase === "ready" ? (
        <p className={`${shell.lede} ${content.lede} ${styles.trackerLede}`}>
          People placed in a house in the last 6 weeks · {settling} settling in
        </p>
      ) : null}
      {state.phase === "loading" ? <p className={shell.state}>Loading placements…</p> : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="Placements didn’t load." onRetry={retry} /> : null}
      {notice ? <p className={shell.alert} role="alert">{notice}</p> : null}
      {state.phase === "ready" && list.length === 0 ? (
        <p className={shell.state}>No one placed yet. Place someone from Follow-up with “Place”.</p>
      ) : null}
      {list.length > 0 ? (
        <div className={styles.table}>
          <div className={styles.tableHead} aria-hidden="true">
            <span>Person</span>
            <span>House</span>
            <span>Where they’re at</span>
            <span />
          </div>
          <ul className={styles.list} data-testid="placements">
            {list.map((row, index) => {
              const canStep = state.phase === "ready" && row.next && !row.cancelledAt;
              const leader = row.leaders[0];
              const leaderFirst = leader?.name.split(" ")[0] || "";
              const leaderChat = whatsAppHref(leader?.phone ?? null);
              const { toLeader } = placementMessages(row, origin);
              const settled = Boolean(row.joinedAt);
              return (
                <li key={row.id} className={`${styles.row} ${row.overdue ? styles.rowOverdue : ""}`} data-testid="placement">
                  <div className={styles.who}>
                    <span className={`${styles.av} ${styles.avSm} ${TINT[index % TINT.length]}`} aria-hidden="true">
                      {initials(row.person.name || "?")}
                    </span>
                    <div className={styles.whoText}>
                      <b>{row.person.name || "Someone"}</b>
                      <span className={styles.phoneHouse}>{houseTitle(row.house)}</span>
                      {row.overdue ? <span className={styles.warn}>{leaderFirst || "The leader"} hasn’t said hi yet</span> : null}
                      {row.cantMakeItAt && !row.joinedAt ? <span className={styles.warn}>Can’t make it this week</span> : null}
                      {row.cancelledAt ? <span className={styles.meta}>Closed {shortDate(row.cancelledAt)}</span> : null}
                    </div>
                  </div>
                  <span className={styles.house}>{houseTitle(row.house)}</span>
                  <PlacementSteps view={row} compact />
                  <div className={styles.actions}>
                    {settled ? (
                      <span className={styles.ok}>
                        <CheckIcon />
                        Settled
                      </span>
                    ) : null}
                    {row.overdue && leaderChat ? (
                      <a
                        className={styles.smButton}
                        href={`${leaderChat}?text=${encodeURIComponent(toLeader)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Nudge {leaderFirst}
                      </a>
                    ) : null}
                    {canStep && row.next ? (
                      <button
                        type="button"
                        className={row.next === "joined" ? styles.smPrimary : styles.smButton}
                        disabled={busy === row.id}
                        onClick={() => void step(row, row.next!)}
                      >
                        {NEXT_ACTION[row.next]}
                      </button>
                    ) : null}
                    <div className={styles.links}>
                      {row.links ? (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(`${origin}${row.links!.person}`);
                            setNotice(`${row.person.name.split(" ")[0]}’s next-steps link is copied.`);
                          }}
                        >
                          Copy their link
                        </button>
                      ) : null}
                      {canStep ? (
                        <button type="button" disabled={busy === row.id} onClick={() => void step(row, "cancel")}>
                          Close
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const TINT = [styles.a4, styles.a5, styles.a3, styles.a2, styles.a1];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
