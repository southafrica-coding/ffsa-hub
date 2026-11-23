"use client";

import { useState, type FormEvent } from "react";
import { missioSkinVars } from "@/components/missio/access";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import { MissioPublicMark } from "@/components/missio/public-mark";
import connect from "../connect/connect.module.css";
import styles from "./care.module.css";

type Need = "prayer" | "talk" | "practical";
type Privacy = "pastors" | "pastors_leaders" | "house";

const NEED_LABEL: Record<Need, string> = {
  prayer: "Prayer",
  talk: "Someone to talk to",
  practical: "Practical help · meals, a lift, a visit",
};
const PRIVACY_LABEL: Record<Privacy, string> = {
  pastors: "Pastors only",
  pastors_leaders: "Pastors and my house church leaders",
  house: "My house church can pray too",
};

export type CareSubmit = (body: unknown) => Promise<{ first: string | null }>;

/**
 * Board M14b, the care link: what they'd like, who can know, then thanks.
 * Prayer can be anonymous; talk, practical help and urgent need a phone.
 * No login.
 */
export function CareForm({ submit = defaultSubmit }: { submit?: CareSubmit }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [body, setBody] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("pastors");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [first, setFirst] = useState<string | null>(null);

  const replies = urgent || needs.some((need) => need !== "prayer");

  function toggle(need: Need) {
    setNeeds((list) => (list.includes(need) ? list.filter((item) => item !== need) : [...list, need]));
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (needs.length === 0) return setError("Choose at least one.");
    setError(null);
    setStep(2);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (replies && !phone.trim()) return setError("Add a phone number so someone can reply.");
    if (!consent) return setError("Tick the box so we can keep this to care for you.");
    setPending(true);
    setError(null);
    try {
      const result = await submit({
        needs,
        privacy,
        urgent,
        consent: true,
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(website ? { website } : {}),
      });
      setFirst(result.first ?? (name.trim().split(/\s+/)[0] || null));
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error && caught.message === "429" ? "Too many tries. Wait a minute and send again." : "That didn’t send. Check the details and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${connect.page}`} style={missioSkinVars()} data-skin="missio" data-care={step}>
      <div className={connect.column}>
        <MissioPublicMark />
        {step === 3 ? (
          <div className={styles.thanks} data-testid="care-thanks">
            <h1>We’ve got you{first ? `, ${first}` : ""}.</h1>
            <p className={connect.lede}>
              {replies ? "A pastor will WhatsApp you within a day. " : ""}
              We’re praying for you.
            </p>
            {urgent ? <p className={connect.lede}>Because it’s urgent, a pastor will phone you today.</p> : null}
          </div>
        ) : null}

        {step === 1 ? (
          <form className={connect.form} onSubmit={next} noValidate data-testid="care-step-1">
            <h1>How can we stand with you?</h1>
            <div className={connect.group}>
              <p className={connect.fieldLabel}>I’d like…</p>
              <div className={connect.choices}>
                {(Object.keys(NEED_LABEL) as Need[]).map((need) => (
                  <label key={need} className={`${connect.choice} ${needs.includes(need) ? connect.choiceOn : ""}`}>
                    <input type="checkbox" checked={needs.includes(need)} onChange={() => toggle(need)} />
                    <span>{NEED_LABEL[need]}</span>
                  </label>
                ))}
              </div>
            </div>
            <label>
              <span>
                Tell us a little <span className={connect.optional}>· as much as you like</span>
              </span>
              <textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
            </label>
            {error ? (
              <p className={connect.banner} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit">Next</button>
          </form>
        ) : null}

        {step === 2 ? (
          <form className={connect.form} onSubmit={(event) => void send(event)} noValidate data-testid="care-step-2">
            <h1>Who can know about this?</h1>
            <div className={connect.choices} role="radiogroup" aria-label="Who can know">
              {(Object.keys(PRIVACY_LABEL) as Privacy[]).map((value) => (
                <label key={value} className={`${connect.choice} ${privacy === value ? connect.choiceOn : ""}`}>
                  <input type="radio" name="privacy" checked={privacy === value} onChange={() => setPrivacy(value)} />
                  <span>{PRIVACY_LABEL[value]}</span>
                </label>
              ))}
            </div>
            <label>
              <span>
                Your name {replies ? null : <span className={connect.optional}>· optional</span>}
              </span>
              <input value={name} maxLength={80} autoComplete="name" onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>
                Phone {replies ? null : <span className={connect.optional}>· optional</span>}
              </span>
              <input value={phone} maxLength={40} inputMode="tel" autoComplete="tel" onChange={(event) => setPhone(event.target.value)} />
            </label>
            {!replies ? <p className={styles.help}>For prayer only, you can leave both blank.</p> : null}
            <p className={styles.danger}>
              In danger right now? Call <a href="tel:112">112</a> from any cellphone, or tick “urgent” and a pastor will phone you today.
            </p>
            <label className={connect.toggle}>
              <input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} />
              <span>It’s urgent</span>
            </label>
            <label className={connect.toggle}>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span className={styles.consentText}>
                I’m happy for Missio to keep this to care for me. Only the people I chose above will see it, and I can ask for it to
                be removed anytime.
              </span>
            </label>
            <input
              className={connect.honeypot}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              name="website"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
            {error ? (
              <p className={connect.banner} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send to the pastors"}
            </button>
            <button type="button" className={styles.back} onClick={() => setStep(1)}>
              Back
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}

async function defaultSubmit(body: unknown): Promise<{ first: string | null }> {
  const res = await fetch("/api/serve/missio/care", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as { first: string | null };
}
