"use client";

// The event helper's questions. One page, a few short sections; follow-up
// questions (the band, a choir, cover outdoors) appear only when they apply.
// The server checks every answer again (parseHelperAnswers) and sends them
// to the rental manager, who replies with the gear and a quote.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  ACTIVITIES,
  EVENT_TYPES,
  FULFILMENT,
  HIRE_EMAIL,
  INSTRUMENTS,
  MIC_TYPES,
  OWN_AMPS,
  SETTINGS,
  VENUE_SIZES,
  YES_NO,
  YES_NO_UNSURE,
  hasMusicians,
} from "@/lib/equipment/helper";

type Option = { value: string; label: string };

type Answers = {
  eventType: string;
  eventTypeOther: string;
  eventName: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  setupTime: string;
  setting: string;
  venueSize: string;
  venue: string;
  power: string;
  covered: string;
  guests: string;
  activities: string[];
  speakers: string;
  speakersAtOnce: string;
  micType: string;
  vocalists: string;
  choirSize: string;
  instruments: string[];
  instrumentsOther: string;
  ownAmps: string;
  monitors: string;
  projector: string;
  recording: string;
  soundTech: string;
  experienced: string;
  fulfilment: string;
  budget: string;
  name: string;
  email: string;
  phone: string;
  org: string;
  notes: string;
};

const EMPTY: Answers = {
  eventType: "", eventTypeOther: "", eventName: "", date: "", endDate: "", startTime: "", endTime: "", setupTime: "",
  setting: "", venueSize: "", venue: "", power: "", covered: "", guests: "", activities: [],
  speakers: "", speakersAtOnce: "", micType: "", vocalists: "", choirSize: "",
  instruments: [], instrumentsOther: "", ownAmps: "", monitors: "",
  projector: "", recording: "", soundTech: "", experienced: "", fulfilment: "", budget: "",
  name: "", email: "", phone: "", org: "", notes: "",
};

/** Required answers, in the order the form asks them, with what to say. */
const REQUIRED: [keyof Answers, string][] = [
  ["eventType", "Choose what kind of event it is."],
  ["date", "Pick the date of your event."],
  ["guests", "Tell us roughly how many people are coming."],
  ["setting", "Tell us whether it's indoors or outdoors."],
  ["venueSize", "Choose the size of the venue."],
  ["power", "Tell us whether there's power at the venue."],
  ["activities", "Choose at least one thing that will be happening."],
  ["soundTech", "Tell us whether you need someone to run the sound."],
  ["fulfilment", "Tell us whether you'll collect or need delivery."],
  ["name", "Give us your name."],
  ["email", "Give us your email address."],
  ["phone", "Give us a phone number we can reach you on."],
];

const field =
  "w-full rounded-[6px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface2)] px-3.5 py-2.5 text-[16px] text-[color:var(--hire-ink)] placeholder:text-[color:var(--hire-dim)] [color-scheme:dark] focus:border-[color:var(--hire-accent)] focus:outline-none";

function Question({
  id,
  label,
  hint,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={`q-${id}`} className="flex scroll-mt-28 flex-col gap-2">
      <div>
        <span className="text-[15px] font-medium text-[color:var(--hire-ink)]">
          {label}
          {!required && <span className="font-normal text-[color:var(--hire-muted)]"> (optional)</span>}
        </span>
        {hint && <p className="mt-0.5 text-[13px] text-[color:var(--hire-muted)]">{hint}</p>}
      </div>
      {children}
      {error && (
        <p role="alert" className="text-[14px] text-[color:var(--hire-accent)]">
          {error}
        </p>
      )}
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly Option[];
  value: string | string[];
  onChange: (v: string) => void;
  label: string;
}) {
  const multi = Array.isArray(value);
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = multi ? value.includes(o.value) : value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role={multi ? undefined : "radio"}
            aria-pressed={multi ? on : undefined}
            aria-checked={multi ? undefined : on}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-[44px] rounded-[6px] border px-4 text-left text-[14px]",
              on
                ? "border-[color:var(--hire-accent)] bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
                : "border-[color:var(--hire-line-strong)] text-[color:var(--hire-body)] hover:border-[color:var(--hire-body)]"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-6 border-t border-[color:var(--hire-line)] pt-6">
      <h2 className="flex items-baseline gap-3">
        <span className="hire-display text-[34px] !text-[color:var(--hire-accent)]">{n}</span>
        <span className="hire-display text-[34px] md:text-[40px]">{title}</span>
      </h2>
      {children}
    </section>
  );
}

const grid = "grid grid-cols-1 gap-5 sm:grid-cols-2";

/** The answers as the API wants them: empty ones left out. */
function payload(a: Answers) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (Array.isArray(v) ? v.length > 0 || k === "activities" : v.trim() !== "") out[k] = Array.isArray(v) ? v : v.trim();
  }
  return out;
}

export function HelperForm({ today, initialDate, initialEndDate }: { today: string; initialDate: string; initialEndDate: string }) {
  const [a, setA] = useState<Answers>({ ...EMPTY, date: initialDate, endDate: initialEndDate });
  const [errors, setErrors] = useState<Partial<Record<keyof Answers, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => {
    setA((prev) => ({ ...prev, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  /** Tap a chosen chip again to clear it. */
  const choose = (k: keyof Answers) => (v: string) => set(k, (a[k] === v ? "" : v) as never);
  const toggle = (k: "activities" | "instruments") => (v: string) =>
    set(k, a[k].includes(v) ? a[k].filter((x) => x !== v) : [...a[k], v]);

  const music = hasMusicians({ activities: a.activities as never });
  const outdoors = a.setting === "outdoor" || a.setting === "both";
  const choir = a.activities.includes("choir");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const missing: Partial<Record<keyof Answers, string>> = {};
    for (const [k, msg] of REQUIRED) {
      const v = a[k];
      if (Array.isArray(v) ? v.length === 0 : v.trim() === "") missing[k] = msg;
    }
    if (a.eventType === "other" && !a.eventTypeOther.trim()) missing.eventTypeOther = "Tell us what kind of event it is.";
    if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) missing.email = "Check your email address.";
    const first = Object.keys(missing)[0];
    if (first) {
      setErrors(missing);
      document.getElementById(`q-${first}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setBusy(true);
    try {
      const body = payload(a);
      // Follow-ups that no longer apply aren't sent.
      if (a.eventType !== "other") delete body.eventTypeOther;
      if (!outdoors) delete body.covered;
      if (!choir) delete body.choirSize;
      if (!music) for (const k of ["instruments", "instrumentsOther", "ownAmps", "monitors"]) delete body[k];
      const res = await fetch("/api/public/hire-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setFormError(json?.error ?? `We couldn't send your answers. Try again, or email ${HIRE_EMAIL}.`);
        return;
      }
      setSent(json.number as string);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setFormError("We couldn't send your answers. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-[8px] border border-[color:var(--hire-accent)] bg-[color:var(--hire-surface)] p-5 md:p-8">
        <h2 className="hire-display text-[44px] md:text-[60px]">Thanks, we&apos;ve got it</h2>
        <p className="mt-3 text-[16px] leading-relaxed">
          Your reference is <b className="text-[color:var(--hire-ink)]">{sent}</b>. Someone from the team will look at your answers,
          work out what you need, and email you a quote. If anything is unclear we&apos;ll phone you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-10" noValidate>
      <Section n={1} title="Your event">
        <Question id="eventType" label="What kind of event is it?" required error={errors.eventType}>
          <Chips label="Event type" options={EVENT_TYPES} value={a.eventType} onChange={choose("eventType")} />
        </Question>
        {a.eventType === "other" && (
          <Question id="eventTypeOther" label="What is it?" required error={errors.eventTypeOther}>
            <input value={a.eventTypeOther} onChange={(e) => set("eventTypeOther", e.target.value)} maxLength={120} className={field} />
          </Question>
        )}
        <Question id="eventName" label="What's it called?">
          <input value={a.eventName} onChange={(e) => set("eventName", e.target.value)} maxLength={120} placeholder="Youth camp closing night" className={field} />
        </Question>
        <div className={grid}>
          <Question id="date" label="Date" required error={errors.date}>
            <input type="date" min={today} value={a.date} onChange={(e) => set("date", e.target.value)} className={field} />
          </Question>
          <Question id="endDate" label="Last day, if it runs longer">
            <input type="date" min={a.date || today} value={a.endDate} onChange={(e) => set("endDate", e.target.value)} className={field} />
          </Question>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Question id="startTime" label="Starts at">
            <input type="time" value={a.startTime} onChange={(e) => set("startTime", e.target.value)} className={field} />
          </Question>
          <Question id="endTime" label="Ends at">
            <input type="time" value={a.endTime} onChange={(e) => set("endTime", e.target.value)} className={field} />
          </Question>
          <Question id="setupTime" label="Can set up from">
            <input type="time" value={a.setupTime} onChange={(e) => set("setupTime", e.target.value)} className={field} />
          </Question>
        </div>
        <Question id="guests" label="How many people are coming?" hint="A rough number is fine." required error={errors.guests}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={a.guests}
            onChange={(e) => set("guests", e.target.value)}
            placeholder="150"
            className={cn(field, "sm:max-w-[220px]")}
          />
        </Question>
      </Section>

      <Section n={2} title="The venue">
        <Question id="setting" label="Is it indoors or outdoors?" required error={errors.setting}>
          <Chips label="Indoors or outdoors" options={SETTINGS} value={a.setting} onChange={choose("setting")} />
        </Question>
        <Question id="venueSize" label="How big is the space?" required error={errors.venueSize}>
          <Chips label="Venue size" options={VENUE_SIZES} value={a.venueSize} onChange={choose("venueSize")} />
        </Question>
        <Question id="power" label="Is there power at the venue?" hint="Plug points near where the sound will be." required error={errors.power}>
          <Chips label="Power at the venue" options={YES_NO_UNSURE} value={a.power} onChange={choose("power")} />
        </Question>
        {outdoors && (
          <Question id="covered" label="Will the gear be under cover?" hint="A tent, gazebo or roof, in case of rain or strong sun.">
            <Chips label="Cover for the gear" options={YES_NO_UNSURE} value={a.covered} onChange={choose("covered")} />
          </Question>
        )}
        <Question id="venue" label="Where is it?" hint="Venue name and town.">
          <input value={a.venue} onChange={(e) => set("venue", e.target.value)} maxLength={200} placeholder="Grace Church hall, Potchefstroom" className={field} />
        </Question>
      </Section>

      <Section n={3} title="What's happening">
        <Question id="activities" label="What will be happening?" hint="Choose everything that applies." required error={errors.activities}>
          <Chips label="What will be happening" options={ACTIVITIES} value={a.activities} onChange={toggle("activities")} />
        </Question>
        <div className={grid}>
          <Question id="speakers" label="How many people will speak into a mic?" hint="MCs, preachers, speech givers.">
            <input type="number" inputMode="numeric" min={0} value={a.speakers} onChange={(e) => set("speakers", e.target.value)} className={field} />
          </Question>
          <Question id="speakersAtOnce" label="How many speak at the same time?" hint="For example, a panel of 3.">
            <input type="number" inputMode="numeric" min={0} value={a.speakersAtOnce} onChange={(e) => set("speakersAtOnce", e.target.value)} className={field} />
          </Question>
        </div>
        <Question id="micType" label="What kind of mic suits them?">
          <Chips label="Mic type" options={MIC_TYPES} value={a.micType} onChange={choose("micType")} />
        </Question>
        <Question id="vocalists" label="How many singers need their own mic?" hint="Worship leaders, backing vocals, a soloist.">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={a.vocalists}
            onChange={(e) => set("vocalists", e.target.value)}
            className={cn(field, "sm:max-w-[220px]")}
          />
        </Question>
        {choir && (
          <Question id="choirSize" label="How many people are in the choir?">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={a.choirSize}
              onChange={(e) => set("choirSize", e.target.value)}
              className={cn(field, "sm:max-w-[220px]")}
            />
          </Question>
        )}
      </Section>

      {music && (
        <Section n={4} title="The band">
          <Question id="instruments" label="Which instruments are playing?" hint="Choose everything that applies.">
            <Chips label="Instruments" options={INSTRUMENTS} value={a.instruments} onChange={toggle("instruments")} />
          </Question>
          {a.instruments.includes("other") && (
            <Question id="instrumentsOther" label="What else is playing?">
              <input value={a.instrumentsOther} onChange={(e) => set("instrumentsOther", e.target.value)} maxLength={120} placeholder="Cajon, saxophone" className={field} />
            </Question>
          )}
          <Question id="ownAmps" label="Do the musicians bring their own amps?">
            <Chips label="Own amps" options={OWN_AMPS} value={a.ownAmps} onChange={choose("ownAmps")} />
          </Question>
          <Question id="monitors" label="Do the musicians need speakers facing them to hear themselves?" hint="These are called stage monitors.">
            <Chips label="Stage monitors" options={YES_NO_UNSURE} value={a.monitors} onChange={choose("monitors")} />
          </Question>
        </Section>
      )}

      <Section n={music ? 5 : 4} title="Extras and help">
        <div className={grid}>
          <Question id="projector" label="Do you need a projector or screen?">
            <Chips label="Projector or screen" options={YES_NO_UNSURE} value={a.projector} onChange={choose("projector")} />
          </Question>
          <Question id="recording" label="Will you record or livestream it?">
            <Chips label="Recording or livestream" options={YES_NO_UNSURE} value={a.recording} onChange={choose("recording")} />
          </Question>
        </div>
        <Question id="soundTech" label="Do you need someone from our team to run the sound on the day?" required error={errors.soundTech}>
          <Chips label="Someone to run the sound" options={YES_NO_UNSURE} value={a.soundTech} onChange={choose("soundTech")} />
        </Question>
        {a.soundTech !== "yes" && (
          <Question id="experienced" label="Has anyone on your team run a sound system before?">
            <Chips label="Has run sound before" options={YES_NO} value={a.experienced} onChange={choose("experienced")} />
          </Question>
        )}
        <Question id="fulfilment" label="Will you collect the gear, or should we deliver it?" hint="We're at the base in Potchefstroom." required error={errors.fulfilment}>
          <Chips label="Collect or delivery" options={FULFILMENT} value={a.fulfilment} onChange={choose("fulfilment")} />
        </Question>
        <Question id="budget" label="Do you have a budget in mind?">
          <input value={a.budget} onChange={(e) => set("budget", e.target.value)} maxLength={80} placeholder="About R3 000" className={cn(field, "sm:max-w-[320px]")} />
        </Question>
      </Section>

      <Section n={music ? 6 : 5} title="Your details">
        <div className={grid}>
          <Question id="name" label="Your name" required error={errors.name}>
            <input autoComplete="name" value={a.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className={field} />
          </Question>
          <Question id="org" label="Church or organisation">
            <input autoComplete="organization" value={a.org} onChange={(e) => set("org", e.target.value)} maxLength={120} className={field} />
          </Question>
          <Question id="email" label="Email" required error={errors.email}>
            <input type="email" autoComplete="email" value={a.email} onChange={(e) => set("email", e.target.value)} maxLength={200} className={field} />
          </Question>
          <Question id="phone" label="Phone" required error={errors.phone}>
            <input type="tel" autoComplete="tel" value={a.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} className={field} />
          </Question>
        </div>
        <Question id="notes" label="Anything else we should know?">
          <textarea rows={3} value={a.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1500} className={cn(field, "resize-y leading-relaxed")} />
        </Question>
      </Section>

      {formError && (
        <p role="alert" className="text-[15px] text-[color:var(--hire-accent)]">
          {formError}
        </p>
      )}
      <div className="flex flex-col gap-3 border-t border-[color:var(--hire-line)] pt-6 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-[6px] bg-[color:var(--hire-accent)] px-7 text-[16px] font-bold text-[color:var(--hire-on-accent)] disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send to the team
        </button>
        <span className="text-[13px] text-[color:var(--hire-muted)]">We&apos;ll reply by email with the gear you need and a quote.</span>
      </div>
    </form>
  );
}
