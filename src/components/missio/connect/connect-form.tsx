"use client";

import { useState } from "react";
import Image from "next/image";
import { missioSkinVars } from "../access";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { ConnectSubmitError, connectClient, type ConnectClient } from "./client";
import { toConnectBody, validateConnect } from "./validate";
import type { ConnectDraft, ConnectFieldErrors, VisitType } from "./types";
import styles from "./connect.module.css";

const VISITS: Array<{ value: VisitType; label: string }> = [
  { value: "first_time", label: "First time" },
  { value: "been_a_while", label: "Been a while" },
  { value: "regular", label: "I'm a regular" },
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

  function update<K extends keyof ConnectDraft>(key: K, value: ConnectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors = validateConnect(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBanner(null);
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
      <main className={styles.page} data-skin="missio" data-connect="thanks" style={missioSkinVars()}>
        <div className={styles.column}>
          <Image src="/brands/missio/missio-wordmark.png" alt="Missio" width={677} height={188} className={styles.mark} priority />
          <h1>Thanks for connecting with us</h1>
          <p className={styles.thanksBody}>We’re glad you’re here.</p>
          <p className={styles.thanksBody}>Someone from Missio will be in touch this week.</p>
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              setThanks(false);
              setDraft(EMPTY);
              setFieldErrors({});
              setBanner(null);
            }}
          >
            Send another card
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} data-skin="missio" data-connect="form" style={missioSkinVars()}>
      <div className={styles.column}>
        <header>
          <Image src="/brands/missio/missio-wordmark.png" alt="Missio" width={677} height={188} className={styles.mark} priority />
          <h1>Good to see you</h1>
          <p className={styles.lede}>Leave your name and number. Someone from Missio will be in touch this week.</p>
        </header>
        <form className={styles.form} data-testid="connect-form" onSubmit={(event) => void onSubmit(event)} noValidate>
          <label>
            Name
            <input
              name="name"
              autoComplete="name"
              value={draft.name}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "connect-name-error" : undefined}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          {fieldErrors.name ? (
            <p id="connect-name-error" className={styles.fieldError} role="alert">
              {fieldErrors.name}
            </p>
          ) : null}

          <label>
            Phone
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft.phone}
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={fieldErrors.phone ? "connect-phone-error" : undefined}
              onChange={(event) => update("phone", event.target.value)}
            />
          </label>
          {fieldErrors.phone ? (
            <p id="connect-phone-error" className={styles.fieldError} role="alert">
              {fieldErrors.phone}
            </p>
          ) : null}

          <p className={styles.fieldLabel} id="visit-label">
            How well do you know us?
          </p>
          <div className={styles.choices} role="radiogroup" aria-labelledby="visit-label">
            {VISITS.map((visit) => {
              const selected = draft.visitType === visit.value;
              return (
                <label key={visit.value} className={`${styles.choice} ${selected ? styles.choiceOn : ""}`}>
                  <input
                    type="radio"
                    name="visitType"
                    value={visit.value}
                    checked={selected}
                    onChange={() => update("visitType", visit.value)}
                  />
                  <span>{visit.label}</span>
                </label>
              );
            })}
          </div>
          {fieldErrors.visitType ? (
            <p className={styles.fieldError} role="alert">
              {fieldErrors.visitType}
            </p>
          ) : null}

          <label className={styles.toggle}>
            <input
              type="checkbox"
              name="wantsHouseChurch"
              checked={draft.wantsHouseChurch}
              onChange={(event) => update("wantsHouseChurch", event.target.checked)}
            />
            I’d like to join a house church
          </label>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              name="wantsPrayer"
              checked={draft.wantsPrayer}
              aria-expanded={draft.wantsPrayer}
              onChange={(event) => update("wantsPrayer", event.target.checked)}
            />
            I’d like prayer
          </label>
          {draft.wantsPrayer ? (
            <label>
              Prayer request
              <textarea
                name="prayerRequest"
                value={draft.prayerRequest}
                aria-invalid={fieldErrors.prayerRequest ? true : undefined}
                onChange={(event) => update("prayerRequest", event.target.value)}
              />
            </label>
          ) : null}
          {fieldErrors.prayerRequest ? (
            <p className={styles.fieldError} role="alert">
              {fieldErrors.prayerRequest}
            </p>
          ) : null}

          <label>
            <span>
              Anything else <span className={styles.optional}>(optional)</span>
            </span>
            <textarea
              name="notes"
              value={draft.notes}
              aria-invalid={fieldErrors.notes ? true : undefined}
              aria-describedby={fieldErrors.notes ? "connect-notes-error" : undefined}
              onChange={(event) => update("notes", event.target.value)}
            />
          </label>
          {fieldErrors.notes ? (
            <p id="connect-notes-error" className={styles.fieldError} role="alert">
              {fieldErrors.notes}
            </p>
          ) : null}

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

          {banner ? (
            <p className={styles.banner} role="alert" data-testid="connect-banner">
              {banner}
            </p>
          ) : null}

          <button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send my card"}
          </button>
        </form>
      </div>
    </main>
  );
}
