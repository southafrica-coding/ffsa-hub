"use client";

import { useState } from "react";
import { missioSkinVars } from "@/components/missio/access";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import type { FeedbackEntry, Mood, PublicFeedbackView } from "@/lib/missio/feedback";
import connect from "../connect/connect.module.css";
import styles from "./feedback.module.css";

const MOOD_LABEL: Record<Mood, string> = { hard: "Hard", okay: "Okay", good: "Good", great: "Great" };
const MOODS: Mood[] = ["hard", "okay", "good", "great"];

const dateLabel = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

function meetingLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : dateLabel.format(date);
}

function Shell({ children, state }: { children: React.ReactNode; state: string }) {
  return (
    <main
      className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${connect.page}`}
      style={missioSkinVars()}
      data-skin="missio"
      data-feedback={state}
    >
      <div className={connect.column}>{children}</div>
    </main>
  );
}

export function FeedbackStatus({ state }: { state: "invalid" | "limited" | "unavailable" }) {
  const copy = {
    invalid: { title: "This link doesn’t work", body: "Ask your pastor or coach to send the house’s link again." },
    limited: { title: "Too many tries", body: "Wait a minute, then open the link again." },
    unavailable: { title: "Missio didn’t load this", body: "Try again in a minute." },
  }[state];
  return (
    <Shell state={state}>
      <p className={styles.eyebrow}>Missio</p>
      <h1>{copy.title}</h1>
      <p className={connect.lede}>{copy.body}</p>
    </Shell>
  );
}

/** Board M4a: four questions, under a minute, no login. */
export function FeedbackForm({
  token,
  view,
  submit = defaultSubmit,
}: {
  token: string;
  view: PublicFeedbackView;
  submit?: (token: string, body: unknown) => Promise<FeedbackEntry>;
}) {
  const start = view.existing;
  const [attendance, setAttendance] = useState<number>(start?.attendance ?? view.lastAttendance ?? 0);
  const [names, setNames] = useState<string[]>(start?.newNames ?? []);
  const [draftName, setDraftName] = useState("");
  const [mood, setMood] = useState<Mood | "">(start?.mood ?? "");
  const [prayer, setPrayer] = useState(start?.prayer ?? "");
  const [notes, setNotes] = useState(start?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<FeedbackEntry | null>(null);

  function addName() {
    const name = draftName.trim();
    if (!name || names.includes(name) || names.length >= 20) return;
    setNames([...names, name]);
    setDraftName("");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!mood) {
      setError("Choose how it went.");
      return;
    }
    const pendingName = draftName.trim();
    const allNames = pendingName && !names.includes(pendingName) ? [...names, pendingName] : names;
    setPending(true);
    setError(null);
    try {
      const entry = await submit(token, { attendance, mood, newNames: allNames, prayer, notes });
      setNames(allNames);
      setDraftName("");
      setSent(entry);
    } catch {
      setError("That didn’t send. Check your signal and try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Shell state="sent">
        <p className={styles.eyebrow}>{view.houseTitle}</p>
        <h1>Thank you.</h1>
        <p className={connect.lede}>Your coach and the pastors have it.</p>
        <p className={styles.big} data-testid="feedback-sent-count">
          <span>{sent.attendance}</span> came
        </p>
        {sent.newNames.length > 0 ? (
          <p className={connect.lede}>New this week: {sent.newNames.join(", ")}. The pastors will follow up.</p>
        ) : null}
        {sent.prayer ? <p className={connect.lede}>We’ll pray for what you shared.</p> : null}
        <button type="button" className={connect.quiet} onClick={() => setSent(null)}>
          Change what I sent
        </button>
      </Shell>
    );
  }

  return (
    <Shell state="form">
      <p className={styles.eyebrow}>
        {view.houseTitle} · {meetingLabel(view.meetingDate)}
      </p>
      <h1>How was it this week?</h1>
      {start ? <p className={connect.lede}>You already sent this week. Change anything and send again.</p> : null}
      <form className={connect.form} onSubmit={(event) => void onSubmit(event)} noValidate data-testid="feedback-form">
        <div className={styles.group}>
          <p className={connect.fieldLabel} id="fb-count">
            How many came?
          </p>
          <div className={styles.stepper} role="group" aria-labelledby="fb-count">
            <button type="button" className={styles.step} aria-label="One fewer" onClick={() => setAttendance((n) => Math.max(0, n - 1))}>
              −
            </button>
            <input
              aria-label="How many came"
              inputMode="numeric"
              value={String(attendance)}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/\D/g, "") || "0");
                setAttendance(Math.min(500, next));
              }}
            />
            <button type="button" className={styles.step} aria-label="One more" onClick={() => setAttendance((n) => Math.min(500, n + 1))}>
              +
            </button>
          </div>
          <p className={styles.help}>
            {view.lastAttendance != null ? `Last week: ${view.lastAttendance}. ` : ""}Leaders included.
          </p>
        </div>

        <div className={styles.group}>
          <p className={connect.fieldLabel}>Anyone new?</p>
          {names.length > 0 ? (
            <ul className={styles.names}>
              {names.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <button type="button" className={styles.remove} aria-label={`Remove ${name}`} onClick={() => setNames(names.filter((item) => item !== name))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={styles.addRow}>
            <input
              aria-label="New person's name"
              placeholder="Their name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addName();
                }
              }}
            />
            <button type="button" className={`${connect.quiet} ${styles.addButton}`} onClick={addName}>
              Add
            </button>
          </div>
          <p className={styles.help}>The pastors see new names and follow up.</p>
        </div>

        <div className={styles.group}>
          <p className={connect.fieldLabel} id="fb-mood">
            How did it go?
          </p>
          <div className={styles.moods} role="radiogroup" aria-labelledby="fb-mood">
            {MOODS.map((value) => (
              <label key={value} className={`${connect.choice} ${styles.mood} ${mood === value ? connect.choiceOn : ""}`}>
                <input type="radio" name="mood" value={value} checked={mood === value} onChange={() => setMood(value)} />
                <span>{MOOD_LABEL[value]}</span>
              </label>
            ))}
          </div>
        </div>

        <label>
          <span>
            Prayer needs <span className={connect.optional}>· optional</span>
          </span>
          <textarea name="prayer" value={prayer} maxLength={2000} onChange={(event) => setPrayer(event.target.value)} />
        </label>
        <p className={styles.help}>Only your coach and the pastors see this.</p>

        <label>
          <span>
            Anything else for the pastors? <span className={connect.optional}>· optional</span>
          </span>
          <textarea name="notes" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
        </label>

        {error ? (
          <p className={connect.banner} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send to your coach and the pastors"}
        </button>
      </form>
    </Shell>
  );
}

async function defaultSubmit(token: string, body: unknown): Promise<FeedbackEntry> {
  const res = await fetch(`/api/serve/missio/feedback/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { entry: FeedbackEntry };
  return json.entry;
}
