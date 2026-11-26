"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/missio/calendar/dates";
import { googleSubscribeUrl, webcalUrl, withoutNational, type CalendarShare } from "@/lib/missio/calendar/share-links";
import shell from "../shell.module.css";
import { CalendarApiError, calendarErrorCopy, type CalendarClient } from "./client";
import { CalendarSheet } from "./sheet";
import styles from "./calendar.module.css";

type State = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; share: CalendarShare };

/**
 * Share: subscribe in Google Calendar, copy the link, open the read-only
 * page, or reset the link. Opening this makes the link the first time.
 */
export function ShareSheet({ client, onClose }: { client: CalendarClient; onClose: () => void }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [national, setNational] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    client.share(false).then(
      (share) => active && setState({ phase: "ready", share }),
      (error: unknown) =>
        active && setState({ phase: "error", message: calendarErrorCopy(error instanceof CalendarApiError ? error.code : null) })
    );
    return () => {
      active = false;
    };
  }, [client, attempt]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
      setNotice("Couldn’t copy. Press and hold the link to copy it.");
    }
  }

  async function reset() {
    setResetting(true);
    setNotice(null);
    try {
      const share = await client.share(true);
      setState({ phase: "ready", share });
      setConfirmReset(false);
      setCopied(null);
      setNotice("New link made. The old one has stopped working.");
    } catch (error) {
      setNotice(calendarErrorCopy(error instanceof CalendarApiError ? error.code : null));
    } finally {
      setResetting(false);
    }
  }

  const share = state.phase === "ready" ? state.share : null;
  const feed = share ? (national ? share.feedUrl : withoutNational(share.feedUrl)) : "";

  return (
    <CalendarSheet title="Share the calendar" testId="calendar-share" onClose={onClose} focusFirstField={false}>
      {state.phase === "loading" ? <p className={shell.state}>Getting the link…</p> : null}
      {state.phase === "error" ? (
        <div className={styles.shareError} role="alert">
          <p>{state.message}</p>
          <button type="button" className={shell.ghost} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {share ? (
        <div className={styles.share}>
          <p className={styles.sheetText}>
            Anyone with this link can see the calendar. Only pastors can change it. Subscribed calendars update by
            themselves; Google can take a few hours to catch up.
          </p>
          <a
            className={`${shell.primary} ${styles.bigButton}`}
            href={googleSubscribeUrl(feed)}
            target="_blank"
            rel="noopener noreferrer"
            data-autofocus=""
            data-testid="calendar-google"
          >
            <GoogleIcon />
            Subscribe in Google Calendar
          </a>
          <a className={`${shell.ghost} ${styles.bigButton}`} href={webcalUrl(feed)} data-testid="calendar-webcal">
            Add to Apple or Outlook calendar
          </a>

          <label className={shell.field}>
            Calendar link (.ics)
            <span className={styles.copyRow}>
              <input readOnly value={feed} onFocus={(e) => e.currentTarget.select()} data-testid="calendar-feed-url" />
              <button type="button" className={shell.ghost} onClick={() => void copy(feed, "feed")}>
                {copied === "feed" ? "Copied" : "Copy link"}
              </button>
            </span>
          </label>
          <p className={styles.hint}>
            In Google Calendar on a computer: Other calendars → + → From URL, then paste. On a phone, open the Google
            button above.
          </p>
          <label className={styles.check}>
            <input type="checkbox" checked={national} onChange={(e) => setNational(e.target.checked)} />
            Include public holidays and school terms
          </label>

          <div className={styles.shareLinks}>
            <a href={share.webUrl} target="_blank" rel="noopener noreferrer" className={styles.textLink}>
              Open the read-only page
            </a>
            <button type="button" className={styles.textLink} onClick={() => void copy(share.webUrl, "web")}>
              {copied === "web" ? "Page link copied" : "Copy page link"}
            </button>
          </div>

          {notice ? (
            <p className={shell.info} role="status">
              {notice}
            </p>
          ) : null}

          <div className={styles.resetBox}>
            <p className={styles.hint}>
              Link {share.prefix}…{share.rotatedAt ? ` · reset ${formatDate(share.rotatedAt.slice(0, 10))}` : ""}
            </p>
            {confirmReset ? (
              <>
                <p className={styles.sheetText}>
                  The old link stops at once. Everyone subscribed stops getting updates until they subscribe again
                  with the new link.
                </p>
                <div className={styles.footRow}>
                  <button type="button" className={shell.ghost} onClick={() => setConfirmReset(false)}>
                    Keep this link
                  </button>
                  <button type="button" className={styles.danger} disabled={resetting} onClick={() => void reset()}>
                    {resetting ? "Resetting…" : "Reset the link"}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className={styles.textLink} onClick={() => setConfirmReset(true)}>
                Reset the link…
              </button>
            )}
          </div>
        </div>
      ) : null}
    </CalendarSheet>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
    </svg>
  );
}
