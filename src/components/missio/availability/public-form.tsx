"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { missioSkinVars } from "@/components/missio/access";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import type { AvailabilityChoice } from "@/lib/missio/availability/grid";
import type { PublicSaveInput } from "@/lib/missio/availability/schema";
import type { PublicAvailabilityView, PublicDateView } from "@/lib/missio/availability/public-view";
import styles from "./public-form.module.css";

const CHOICES: { status: AvailabilityChoice; label: string }[] = [
  { status: "available", label: "Available" },
  { status: "maybe", label: "Maybe" },
  { status: "unavailable", label: "Unavailable" },
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
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>Missio</p>
        <h1>{copy.title}</h1>
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
  if (!response.ok) throw new Error(body.error || "That Sunday didn't save.");
}

export function PublicAvailabilityForm({
  token,
  view,
  save = (input) => saveOnServer(token, input),
}: {
  token: string;
  view: PublicAvailabilityView;
  save?: (input: PublicSaveInput) => Promise<void>;
}) {
  const [dates, setDates] = useState<PublicDateView[]>(view.dates);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(date: PublicDateView, status: AvailabilityChoice, note: string) {
    setPending(date.serviceDate);
    setError(null);
    try {
      await save({ serviceDate: date.serviceDate, status, note });
      setDates((current) =>
        current.map((item) => (item.serviceDate === date.serviceDate ? { ...item, status, note } : item))
      );
      setNotice(`Saved for ${date.label}.`);
    } catch (caught) {
      setNotice(null);
      setError(caught instanceof Error ? caught.message : "That Sunday didn't save.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main
      className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${styles.page}`}
      style={skin}
      data-missio-content=""
      data-state={dates.some((date) => date.status) ? "filled" : "empty"}
      data-testid="public-availability"
    >
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>Missio</p>
        <h1>Hi {view.firstName}</h1>
        <p className={styles.lede}>
          Mark the Sundays you can serve. Each tap saves. You can change an answer until the end of that Sunday.
        </p>
        {dates.length === 0 ? <p className={styles.lede}>There are no Sundays left on this link.</p> : null}
        <div className={styles.days}>
          {dates.map((date) => (
            <fieldset key={date.serviceDate} className={styles.day} disabled={pending === date.serviceDate}>
              <legend>
                {date.label}
                {date.editable ? null : <span className={styles.closed}>Closed</span>}
              </legend>
              <div className={styles.choices} role="group" aria-label={date.label}>
                {CHOICES.map((choice) => (
                  <button
                    key={choice.status}
                    type="button"
                    className={styles.choice}
                    data-status={choice.status}
                    aria-pressed={date.status === choice.status}
                    disabled={!date.editable || pending === date.serviceDate}
                    onClick={() => persist(date, choice.status, date.note)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <label className={styles.note}>
                Note, optional
                <textarea
                  value={date.note}
                  maxLength={500}
                  disabled={!date.editable || pending === date.serviceDate}
                  aria-label={`Note for ${date.label}`}
                  onChange={(event) => {
                    const note = event.target.value;
                    setDates((current) =>
                      current.map((item) => (item.serviceDate === date.serviceDate ? { ...item, note } : item))
                    );
                  }}
                  onBlur={() => {
                    if (!date.editable || !date.status) return;
                    const latest = dates.find((item) => item.serviceDate === date.serviceDate);
                    if (!latest?.status) return;
                    void persist(latest, latest.status, latest.note);
                  }}
                />
              </label>
            </fieldset>
          ))}
        </div>
        <p className={styles.status} role="status">
          {error ?? notice ?? ""}
        </p>
      </div>
    </main>
  );
}
