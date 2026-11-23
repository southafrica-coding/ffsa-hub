"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { missioSkinVars } from "@/components/missio/access";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import { MissioPublicMark } from "@/components/missio/public-mark";
import type { AvailabilityChoice } from "@/lib/missio/availability/grid";
import type { PublicSaveInput } from "@/lib/missio/availability/schema";
import type { PublicAvailabilityView, PublicDateView } from "@/lib/missio/availability/public-view";
import styles from "./public-form.module.css";

const CHOICES: { status: AvailabilityChoice; label: string }[] = [
  { status: "available", label: "Yes" },
  { status: "maybe", label: "Maybe" },
  { status: "unavailable", label: "No" },
];

const skin = missioSkinVars() as CSSProperties;

export function AvailabilityStatus({
  state,
}: {
  state: "invalid" | "expired" | "limited" | "unavailable";
}) {
  const copy = {
    invalid: {
      title: "This link doesn't work",
      body: "Ask your pastor to send it again.",
    },
    expired: {
      title: "This link has expired",
      body: "Ask your pastor for a new one.",
    },
    limited: {
      title: "Too many tries",
      body: "Wait a minute, then open the link again.",
    },
    unavailable: {
      title: "Missio didn't load this link",
      body: "Try again in a minute.",
    },
  }[state];

  return (
    <main className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${styles.page}`} style={skin} data-missio-content="" data-state={state}>
      <div className={styles.column}>
        <MissioPublicMark />
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.lede}>{copy.body}</p>
      </div>
    </main>
  );
}

async function saveOnServer(token: string, input: PublicSaveInput) {
  const response = await fetch(`/api/serve/missio/${encodeURIComponent(token)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "That didn't send. Try again.");
}

/** "Sunday 22 Nov" → "Sun 22 Nov", as on board M6a. */
function shortLabel(label: string): string {
  return label.replace(/^([A-Za-z]{3})[A-Za-z]*/, "$1");
}

function sameAnswers(a: PublicDateView[], b: PublicDateView[]): boolean {
  return a.every((item, index) => item.status === b[index]?.status);
}

function ChoiceIcon({ status }: { status: AvailabilityChoice }) {
  const path =
    status === "available" ? "M5 12.5l4.5 4.5L19 7.5" : status === "unavailable" ? "M6.5 6.5l11 11M17.5 6.5l-11 11" : null;
  if (path) {
    return (
      <svg className={styles.icon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
    );
  }
  return (
    <svg className={styles.icon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
    </svg>
  );
}

const ANSWER_WORD: Record<AvailabilityChoice, string> = { available: "Yes", maybe: "Maybe", unavailable: "No" };

/**
 * Board M6a: six dates, three taps each, then Send. Answers stay on the phone
 * until Send; a date nobody touched keeps its saved answer (and its note).
 */
export function PublicAvailabilityForm({
  token,
  view,
  save = (input) => saveOnServer(token, input),
}: {
  token: string;
  view: PublicAvailabilityView;
  save?: (input: PublicSaveInput) => Promise<void>;
}) {
  const [saved, setSaved] = useState<PublicDateView[]>(view.dates);
  const [dates, setDates] = useState<PublicDateView[]>(view.dates);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = dates.filter((date) => date.status).length;
  const changed = !sameAnswers(dates, saved);

  function choose(serviceDate: string, status: AvailabilityChoice) {
    setError(null);
    setDates((current) => current.map((item) => (item.serviceDate === serviceDate ? { ...item, status } : item)));
  }

  async function send() {
    setSending(true);
    setError(null);
    const todo = dates.filter((date, index) => date.editable && date.status && date.status !== saved[index]?.status);
    try {
      for (const date of todo) {
        // The note isn't shown on this page; send the saved one back so it isn't lost.
        await save({ serviceDate: date.serviceDate, status: date.status as AvailabilityChoice, note: date.note });
        setSaved((current) =>
          current.map((item) => (item.serviceDate === date.serviceDate ? { ...item, status: date.status } : item))
        );
      }
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  const pageClass = `${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${styles.page}`;

  if (sent) {
    const yes = dates.filter((date) => date.status === "available").length;
    return (
      <main className={pageClass} style={skin} data-missio-content="" data-state="sent" data-testid="public-availability">
        <div className={styles.column}>
          <MissioPublicMark />
          <div className={styles.sent}>
            <span className={styles.sentMark} aria-hidden>
              <ChoiceIcon status="available" />
            </span>
            <h1 className={styles.sentTitle}>Thanks, {view.firstName}.</h1>
            <p className={styles.sentBody}>
              {yes === 0
                ? "Your answers are in. Your pastors can see them now."
                : `You’re down for ${yes === 1 ? "1 Sunday" : `${yes} Sundays`}. Your pastors can see your answers now.`}
            </p>
            <ul className={styles.summary}>
              {dates.map((date) => (
                <li key={date.serviceDate}>
                  <b>{shortLabel(date.label)}</b>
                  {date.status ? (
                    <span className={styles.answer} data-status={date.status}>
                      <ChoiceIcon status={date.status} />
                      {ANSWER_WORD[date.status]}
                    </span>
                  ) : (
                    <span className={styles.answer}>No answer</span>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className={styles.change} onClick={() => setSent(false)}>
              Change my answers
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className={pageClass}
      style={skin}
      data-missio-content=""
      data-state={saved.some((date) => date.status) ? "filled" : "empty"}
      data-testid="public-availability"
    >
      <div className={styles.column}>
        <MissioPublicMark />
        <h1 className={styles.title}>Hi {view.firstName}, can you serve?</h1>
        {dates.length === 0 ? <p className={styles.lede}>There are no Sundays left on this link.</p> : null}
        <div className={styles.days}>
          {dates.map((date) => (
            <fieldset key={date.serviceDate} className={styles.day} disabled={!date.editable || sending}>
              <legend>
                <b>{shortLabel(date.label)}</b>
                {date.editable ? null : <span className={styles.closed}>Closed</span>}
              </legend>
              <div className={styles.choices} role="group" aria-label={date.label}>
                {CHOICES.map((choice) => {
                  const on = date.status === choice.status;
                  return (
                    <button
                      key={choice.status}
                      type="button"
                      className={styles.choice}
                      data-status={choice.status}
                      aria-pressed={on}
                      disabled={!date.editable || sending}
                      onClick={() => choose(date.serviceDate, choice.status)}
                    >
                      {on && choice.status !== "maybe" ? <ChoiceIcon status={choice.status} /> : null}
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
      {dates.length > 0 ? (
        <div className={styles.footer}>
          <div className={styles.footerInner}>
            <span className={styles.count} role="status">
              {error ?? `${answered} of ${dates.length} answered`}
            </span>
            <button
              type="button"
              className={styles.send}
              disabled={sending || answered === 0}
              onClick={() => (changed ? void send() : setSent(true))}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
