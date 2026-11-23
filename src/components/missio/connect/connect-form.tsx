"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { missioSkinVars } from "../access";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { ConnectSubmitError, connectClient, type ConnectClient } from "./client";
import { toConnectBody, validateConnect } from "./validate";
import type { ConnectDraft, ConnectFieldErrors, VisitType } from "./types";
import styles from "./connect.module.css";

const VISITS: Array<{ value: VisitType; label: string }> = [
  { value: "first_time", label: "First time at Missio" },
  { value: "been_a_while", label: "First time in a while" },
  { value: "regular", label: "I come regularly" },
];

const EMPTY: ConnectDraft = {
  name: "",
  phone: "",
  visitType: "",
  wantsHouseChurch: false,
  wantsPrayer: false,
  prayerRequest: "",
  notes: "",
};

export function ConnectForm({ client = connectClient }: { client?: ConnectClient }) {
  const [draft, setDraft] = useState<ConnectDraft>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<ConnectFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [house, setHouse] = useState<"" | "yes" | "no">("");

  function update<K extends keyof ConnectDraft>(key: K, value: ConnectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function focusFirstError(errors: ConnectFieldErrors) {
    const first = (["name", "phone"] as const).find((key) => errors[key]);
    const target = first ? `input[name=${first}]` : "input[name=visitType]";
    requestAnimationFrame(() => (document.querySelector(target) as HTMLElement | null)?.focus());
  }

  // One page, two screen-heights (board M5a): no stepper and no "Next".
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors = validateConnect(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBanner(Object.keys(errors).length > 1 ? "A few things to fix before sending." : "One thing to fix before sending.");
      focusFirstError(errors);
      return;
    }
    setPending(true);
    setBanner(null);
    setFieldErrors({});
    try {
      await client.submit(toConnectBody(draft));
      setThanks(true);
    } catch (caught) {
      if (caught instanceof ConnectSubmitError && caught.code === "invalid_input") {
        setFieldErrors(caught.fieldErrors);
        setBanner(Object.keys(caught.fieldErrors).length > 0 ? null : missioFixedCopy("invalid_input"));
      } else if (caught instanceof MissioApiError) {
        setBanner(missioFixedCopy(caught.code, caught.retryAfterSeconds));
      } else {
        setBanner(missioFixedCopy(null));
      }
    } finally {
      setPending(false);
    }
  }

  if (thanks) {
    return (
      <main className={`${styles.page} ${styles.thanksPage}`} data-skin="missio" data-connect="thanks" style={missioSkinVars()}>
        <div className={`${styles.column} ${styles.thanksColumn}`}>
          <Image src="/brands/missio/missio-wordmark-paper.png" alt="Missio" width={677} height={188} className={styles.thanksMark} priority />
          <h1>Thank you.</h1>
          <p className={styles.thanksBody}>
            {house === "yes"
              ? "Someone from Missio will WhatsApp you this week, and we’ll help you find a house church near you."
              : "Someone from Missio will WhatsApp you this week. We’re glad you’re here."}
          </p>
          <span className={styles.thanksRule} aria-hidden="true" />
          <p className={styles.thanksSmall}>
            Going through something? <Link href="/serve/missio/care">Ask for prayer or help</Link>. You choose who knows.
          </p>
          <button
            type="button"
            className={styles.thanksAgain}
            onClick={() => {
              setThanks(false);
              setHouse("");
              setDraft(EMPTY);
              setFieldErrors({});
              setBanner(null);
            }}
          >
            Fill in a card for a friend
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} data-skin="missio" data-connect="form" style={missioSkinVars()}>
      <div className={styles.split}>
        <header className={styles.welcome}>
          <Image src="/brands/missio/missio-wordmark.png" alt="Missio" width={677} height={188} className={`${styles.mark} ${styles.markInk}`} priority />
          <Image src="/brands/missio/missio-wordmark-paper.png" alt="" width={677} height={188} className={`${styles.mark} ${styles.markPaper}`} aria-hidden="true" />
          <h1>
            We’re glad
            <br />
            you’re here.
          </h1>
          <p className={styles.lede}>Tell us who you are and someone from Missio will say hi this week.</p>
        </header>
        <form className={styles.form} data-testid="connect-form" onSubmit={(event) => void onSubmit(event)} noValidate>
          {banner ? (
            <p className={styles.banner} role="alert" data-testid="connect-banner">
              <AlertIcon />
              {banner}
            </p>
          ) : null}

          <div className={styles.field}>
            <label htmlFor="connect-name">Your name</label>
            <input
              id="connect-name"
              name="name"
              autoComplete="name"
              value={draft.name}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "connect-name-error" : undefined}
              onChange={(event) => update("name", event.target.value)}
            />
            {fieldErrors.name ? (
              <p id="connect-name-error" className={styles.fieldError} role="alert">
                <AlertIcon />
                {fieldErrors.name}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="connect-phone">Phone number</label>
            <input
              id="connect-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft.phone}
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={fieldErrors.phone ? "connect-phone-error" : "connect-phone-help"}
              onChange={(event) => update("phone", event.target.value)}
            />
            {fieldErrors.phone ? (
              <p id="connect-phone-error" className={styles.fieldError} role="alert">
                <AlertIcon />
                {fieldErrors.phone}
              </p>
            ) : (
              <p id="connect-phone-help" className={styles.help}>
                So we can WhatsApp you. Nothing else.
              </p>
            )}
          </div>

          <div className={styles.field}>
            <p className={styles.fieldLabel} id="connect-visit">
              Is this your…
            </p>
            <div className={styles.choices} role="radiogroup" aria-labelledby="connect-visit">
              {VISITS.map((visit) => {
                const selected = draft.visitType === visit.value;
                return (
                  <label key={visit.value} className={`${styles.choice} ${selected ? styles.choiceOn : ""}`}>
                    <input type="radio" name="visitType" value={visit.value} checked={selected} onChange={() => update("visitType", visit.value)} />
                    <span>{visit.label}</span>
                  </label>
                );
              })}
            </div>
            {fieldErrors.visitType ? (
              <p className={styles.fieldError} role="alert">
                <AlertIcon />
                {fieldErrors.visitType}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <p className={styles.fieldLabel} id="house-label">
              Would you like to join a house church?
            </p>
            <p className={`${styles.help} ${styles.helpUnder}`} id="house-help">
              A small group that meets in a home during the week.
            </p>
            <div className={styles.pair} role="radiogroup" aria-labelledby="house-label" aria-describedby="house-help">
              {(
                [
                  { value: "yes", label: "Yes please" },
                  { value: "no", label: "Not right now" },
                ] as const
              ).map((option) => (
                <label key={option.value} className={`${styles.choice} ${styles.choiceCentre} ${house === option.value ? styles.choiceOn : ""}`}>
                  <input
                    type="radio"
                    name="wantsHouseChurch"
                    value={option.value}
                    checked={house === option.value}
                    onChange={() => {
                      setHouse(option.value);
                      update("wantsHouseChurch", option.value === "yes");
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="connect-prayer">
              Anything we can pray about? <span className={styles.optional}>· optional</span>
            </label>
            <textarea
              id="connect-prayer"
              name="prayerRequest"
              placeholder="Only our pastors will read this."
              value={draft.prayerRequest}
              aria-invalid={fieldErrors.prayerRequest ? true : undefined}
              aria-describedby={fieldErrors.prayerRequest ? "prayer-error" : undefined}
              onChange={(event) => {
                update("prayerRequest", event.target.value);
                update("wantsPrayer", event.target.value.trim().length > 0);
              }}
            />
            {fieldErrors.prayerRequest ? (
              <p id="prayer-error" className={styles.fieldError} role="alert">
                <AlertIcon />
                {fieldErrors.prayerRequest}
              </p>
            ) : null}
          </div>

          <input
            className={styles.honeypot}
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            defaultValue=""
            data-testid="connect-honeypot"
          />

          <div className={styles.sendBlock}>
            <p className={styles.consent} data-testid="connect-consent">
              By sending this, you’re happy for Missio to keep these details to care for you and to WhatsApp you. Only our pastors and leaders
              see them, and you can ask us to remove them anytime.{" "}
              <a href="/legal/consent" target="_blank" rel="noopener">
                How we look after your details
              </a>
            </p>
            <button type="submit" className={styles.send} disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
