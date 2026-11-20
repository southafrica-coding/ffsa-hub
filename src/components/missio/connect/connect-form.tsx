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

const STEP_ONE: ReadonlyArray<keyof ConnectFieldErrors> = ["name", "phone"];

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
  // Two short screens (board M5a): who you are, then the rest of the card.
  const [step, setStep] = useState<1 | 2>(1);
  const [house, setHouse] = useState<"" | "yes" | "no">("");

  function update<K extends keyof ConnectDraft>(key: K, value: ConnectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function stepOneErrors(errors: ConnectFieldErrors): ConnectFieldErrors {
    const out: ConnectFieldErrors = {};
    for (const key of STEP_ONE) if (errors[key]) out[key] = errors[key];
    return out;
  }

  function focusFirstError(errors: ConnectFieldErrors) {
    const first = (["name", "phone"] as const).find((key) => errors[key]);
    const target = first ? `input[name=${first}]` : "input[name=visitType]";
    requestAnimationFrame(() => (document.querySelector(target) as HTMLElement | null)?.focus());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (step === 1) {
      const errors = stepOneErrors(validateConnect(draft));
      setFieldErrors(errors);
      setBanner(null);
      if (Object.keys(errors).length > 0) {
        focusFirstError(errors);
        return;
      }
      setStep(2);
      requestAnimationFrame(() => document.getElementById("connect-step-two")?.focus());
      return;
    }
    const errors = validateConnect(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBanner(null);
      if (Object.keys(stepOneErrors(errors)).length > 0) setStep(1);
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
        if (Object.keys(stepOneErrors(caught.fieldErrors)).length > 0) setStep(1);
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
          <h1>Thank you.</h1>
          <p className={styles.thanksBody}>We’re glad you’re here.</p>
          <p className={styles.thanksBody}>
            {house === "yes"
              ? "Someone from Missio will WhatsApp you this week, and we’ll help you find a house church near you."
              : "Someone from Missio will WhatsApp you this week."}
          </p>
          <p className={styles.thanksBody}>
            Going through something? <Link href="/serve/missio/care">Ask for prayer or help</Link>. You choose who knows.
          </p>
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              setThanks(false);
              setStep(1);
              setHouse("");
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
          {step === 1 ? (
            <>
              <h1>
                We’re glad
                <br />
                you’re here.
              </h1>
              <p className={styles.lede}>Tell us who you are and someone from Missio will say hi this week.</p>
            </>
          ) : (
            <h1 id="connect-step-two" tabIndex={-1} className={styles.stepTitle}>
              Is this your…
            </h1>
          )}
        </header>
        <form className={styles.form} data-testid="connect-form" data-step={step} onSubmit={(event) => void onSubmit(event)} noValidate>
          {step === 1 ? (
            <>
              <label>
                Your name
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
                Phone number
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={draft.phone}
                  aria-invalid={fieldErrors.phone ? true : undefined}
                  aria-describedby={fieldErrors.phone ? "connect-phone-error" : "connect-phone-help"}
                  onChange={(event) => update("phone", event.target.value)}
                />
              </label>
              {fieldErrors.phone ? (
                <p id="connect-phone-error" className={styles.fieldError} role="alert">
                  {fieldErrors.phone}
                </p>
              ) : (
                <p id="connect-phone-help" className={styles.help}>
                  So we can WhatsApp you. Nothing else.
                </p>
              )}
            </>
          ) : (
            <>
              <div className={styles.choices} role="radiogroup" aria-labelledby="connect-step-two">
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

              <div className={styles.group}>
                <p className={styles.fieldLabel} id="house-label">
                  Would you like to join a house church?
                </p>
                <p className={styles.help} id="house-help">
                  A small group that meets in a home during the week.
                </p>
                <div className={styles.pair} role="radiogroup" aria-labelledby="house-label" aria-describedby="house-help">
                  {(
                    [
                      { value: "yes", label: "Yes please" },
                      { value: "no", label: "Not right now" },
                    ] as const
                  ).map((option) => (
                    <label key={option.value} className={`${styles.choice} ${house === option.value ? styles.choiceOn : ""}`}>
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

              <label>
                <span>
                  Anything we can pray about? <span className={styles.optional}>· optional</span>
                </span>
                <textarea
                  name="prayerRequest"
                  value={draft.prayerRequest}
                  aria-invalid={fieldErrors.prayerRequest ? true : undefined}
                  aria-describedby="prayer-help"
                  onChange={(event) => {
                    update("prayerRequest", event.target.value);
                    update("wantsPrayer", event.target.value.trim().length > 0);
                  }}
                />
              </label>
              {fieldErrors.prayerRequest ? (
                <p className={styles.fieldError} role="alert">
                  {fieldErrors.prayerRequest}
                </p>
              ) : (
                <p id="prayer-help" className={styles.help}>
                  Only our pastors will read this.
                </p>
              )}

              <p className={styles.consent} data-testid="connect-consent">
                By sending this, you’re happy for Missio to keep these details to care for you and to WhatsApp you.
                Only our pastors and leaders see them, and you can ask us to remove them anytime.{" "}
                <a href="/legal/consent" target="_blank" rel="noopener">
                  How we look after your details
                </a>
              </p>
            </>
          )}

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
            {step === 1 ? "Next" : pending ? "Sending…" : "Send"}
          </button>
          {step === 2 ? (
            <button
              type="button"
              className={styles.quiet}
              data-testid="connect-back"
              onClick={() => {
                setStep(1);
                setFieldErrors({});
                setBanner(null);
              }}
            >
              Back
            </button>
          ) : null}
        </form>
      </div>
    </main>
  );
}
