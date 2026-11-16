// The event helper (/hire/helper): "Not sure what you need? Tell us about
// your event." A short set of plain questions a sound person would ask.
// The answers go to the rental manager, who works out the gear and replies
// with a quote. Nothing here guesses a package: it collects, checks and
// lays out the answers.
//
// Pure (no client, no network) so it can be tested:
//   - the questions' options, shared by the form and the server
//   - parseHelperAnswers: what the public form may send, strictly
//   - summariseAnswers: the answers as labelled sections, plus a few
//     counts worked out from them (mics, instrument inputs) and flags
//     the rental manager should see first

import { z } from "zod";
import { dayCount, isIsoDate } from "./dates";

// ────────────────────────────────────────────────────────────
// The options
// ────────────────────────────────────────────────────────────

type Option = { value: string; label: string };

export const EVENT_TYPES = [
  { value: "church_service", label: "Church service" },
  { value: "worship_night", label: "Worship night" },
  { value: "conference", label: "Conference" },
  { value: "wedding", label: "Wedding" },
  { value: "funeral", label: "Funeral or memorial" },
  { value: "birthday", label: "Birthday or party" },
  { value: "concert", label: "Concert" },
  { value: "outdoor_festival", label: "Outdoor festival" },
  { value: "school_event", label: "School event" },
  { value: "corporate", label: "Corporate event" },
  { value: "outreach", label: "Outreach" },
  { value: "other", label: "Something else" },
] as const satisfies readonly Option[];

export const SETTINGS = [
  { value: "indoor", label: "Indoors" },
  { value: "outdoor", label: "Outdoors" },
  { value: "both", label: "Both" },
] as const satisfies readonly Option[];

export const VENUE_SIZES = [
  { value: "small_room", label: "Small room (up to about 50)" },
  { value: "hall", label: "Hall (about 50 to 200)" },
  { value: "large_hall", label: "Large hall (200 or more)" },
  { value: "open_field", label: "Open field or outdoor area" },
] as const satisfies readonly Option[];

export const YES_NO_UNSURE = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
] as const satisfies readonly Option[];

export const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const satisfies readonly Option[];

/** What will be happening. No DJs: we don't hire DJ gear. */
export const ACTIVITIES = [
  { value: "speeches", label: "Speeches or an MC" },
  { value: "preaching", label: "Preaching or a talk" },
  { value: "worship", label: "Worship team" },
  { value: "live_band", label: "Live band" },
  { value: "choir", label: "Choir" },
  { value: "background_music", label: "Background music from a phone or laptop" },
  { value: "presentations", label: "Slides or presentations" },
  { value: "video", label: "Video with sound" },
  { value: "panel", label: "Panel or Q&A" },
  { value: "performances", label: "Drama or dance" },
] as const satisfies readonly Option[];

export const MIC_TYPES = [
  { value: "handheld", label: "Handheld" },
  { value: "headset", label: "Headset, hands free" },
  { value: "lectern", label: "On a stand or lectern" },
  { value: "unsure", label: "Not sure" },
] as const satisfies readonly Option[];

export const INSTRUMENTS = [
  { value: "acoustic_guitar", label: "Acoustic guitar" },
  { value: "electric_guitar", label: "Electric guitar" },
  { value: "bass", label: "Bass guitar" },
  { value: "keys", label: "Keyboard or piano" },
  { value: "drums", label: "Drum kit" },
  { value: "electronic_drums", label: "Electronic drums" },
  { value: "violin", label: "Violin or other strings" },
  { value: "brass_wind", label: "Brass or wind" },
  { value: "other", label: "Something else" },
] as const satisfies readonly Option[];

export const OWN_AMPS = [
  { value: "yes", label: "Yes, they bring their own" },
  { value: "some", label: "Some of them" },
  { value: "no", label: "No, we need them" },
  { value: "unsure", label: "Not sure" },
] as const satisfies readonly Option[];

export const FULFILMENT = [
  { value: "collect", label: "We'll collect it" },
  { value: "delivery", label: "Please deliver it" },
  { value: "unsure", label: "Not sure yet" },
] as const satisfies readonly Option[];

/** Activities that bring musicians, and so the band questions. */
export const MUSIC_ACTIVITIES = ["worship", "live_band"] as const;

const values = <T extends readonly Option[]>(list: T) =>
  list.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]];

export function labelOf(list: readonly Option[], v: string | null | undefined): string | undefined {
  return list.find((o) => o.value === v)?.label;
}

// ────────────────────────────────────────────────────────────
// Checking the answers
// ────────────────────────────────────────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 30;

/** Empty form fields mean "not answered". */
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const opt = <S extends z.ZodTypeAny>(schema: S) => z.preprocess(blank, schema.optional());
const text = (max: number) => opt(z.string().trim().max(max));
const count = (max: number) => opt(z.coerce.number().int().min(0).max(max));
const pick = <T extends readonly Option[]>(list: T) => z.enum(values(list));

/** Who to reply to. Shared with the pick list (hire-request.ts). */
export const CONTACT_SHAPE = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().min(6).max(40),
  org: text(120),
  notes: text(1500),
};

export const CONTACT_ERRORS: Record<string, string> = {
  name: "Give us your name.",
  email: "Check your email address.",
  phone: "Give us a phone number we can reach you on.",
};

const ANSWERS = z
  .object({
    // The event
    eventType: pick(EVENT_TYPES),
    eventTypeOther: text(120),
    eventName: text(120),
    date: z.string().refine(isIsoDate),
    endDate: opt(z.string().refine(isIsoDate)),
    startTime: opt(z.string().regex(TIME)),
    endTime: opt(z.string().regex(TIME)),
    setupTime: opt(z.string().regex(TIME)),
    // The venue
    setting: pick(SETTINGS),
    venueSize: pick(VENUE_SIZES),
    venue: text(200),
    power: pick(YES_NO_UNSURE),
    covered: opt(pick(YES_NO_UNSURE)),
    // The people
    guests: z.coerce.number().int().min(1).max(100_000),
    // What's happening
    activities: z.array(pick(ACTIVITIES)).min(1).max(ACTIVITIES.length),
    // Microphones
    speakers: count(200),
    speakersAtOnce: count(50),
    micType: opt(pick(MIC_TYPES)),
    vocalists: count(50),
    choirSize: count(500),
    // The band
    instruments: z.array(pick(INSTRUMENTS)).max(INSTRUMENTS.length).default([]),
    instrumentsOther: text(120),
    ownAmps: opt(pick(OWN_AMPS)),
    monitors: opt(pick(YES_NO_UNSURE)),
    // Screens, recording, help
    projector: opt(pick(YES_NO_UNSURE)),
    recording: opt(pick(YES_NO_UNSURE)),
    soundTech: pick(YES_NO_UNSURE),
    experienced: opt(pick(YES_NO)),
    fulfilment: pick(FULFILMENT),
    budget: text(80),
    ...CONTACT_SHAPE,
  })
  .strict();

export type HelperAnswers = z.infer<typeof ANSWERS>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** One sentence per field, so the form can say exactly what's wrong. */
const FIELD_ERRORS: Record<string, string> = {
  eventType: "Choose what kind of event it is.",
  date: "Pick the date of your event.",
  setting: "Tell us whether it's indoors or outdoors.",
  venueSize: "Choose the size of the venue.",
  power: "Tell us whether there's power at the venue.",
  guests: "Tell us roughly how many people are coming.",
  activities: "Choose at least one thing that will be happening.",
  soundTech: "Tell us whether you need someone to run the sound.",
  fulfilment: "Tell us whether you'll collect or need delivery.",
  ...CONTACT_ERRORS,
};

export function parseHelperAnswers(body: unknown, today: string): ParseResult<HelperAnswers> {
  const parsed = ANSWERS.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { ok: false, error: FIELD_ERRORS[field] ?? "Some of your answers didn't come through. Check the form and try again." };
  }
  const a = parsed.data;
  const to = a.endDate ?? a.date;
  if (a.date < today) return { ok: false, error: "The event date can't be in the past." };
  if (to < a.date) return { ok: false, error: "The last day can't be before the first." };
  if (dayCount(a.date, to) > MAX_DAYS) return { ok: false, error: "For events longer than a month, email us directly." };
  if (a.eventType === "other" && !a.eventTypeOther) return { ok: false, error: "Tell us what kind of event it is." };
  return { ok: true, value: a };
}

/** The hire dates: the event's first and last day. */
export function helperRange(a: Pick<HelperAnswers, "date" | "endDate">): { from: string; to: string } {
  return { from: a.date, to: a.endDate ?? a.date };
}

export function hasMusicians(a: Pick<HelperAnswers, "activities">): boolean {
  return a.activities.some((x) => (MUSIC_ACTIVITIES as readonly string[]).includes(x));
}

// ────────────────────────────────────────────────────────────
// Laying the answers out for the rental manager
// ────────────────────────────────────────────────────────────

export type SummarySection = { title: string; rows: [label: string, value: string][] };

export type HelperSummary = {
  /** Things to look at first: no power, very large, wants a tech… */
  flags: string[];
  /** Counts worked out from the answers, to start the gear list from. */
  counts: string[];
  sections: SummarySection[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function summariseAnswers(a: HelperAnswers): HelperSummary {
  const music = hasMusicians(a);
  const { from, to } = helperRange(a);

  const flags: string[] = [];
  if (a.power === "no") flags.push("No power at the venue");
  if (a.power === "unsure") flags.push("Not sure there's power at the venue");
  if (a.setting !== "indoor" && a.covered === "no") flags.push("Outdoors with no cover for the gear");
  if (a.guests > 500) flags.push(`Large crowd: about ${a.guests} people`);
  if (a.soundTech === "yes") flags.push("Wants someone from our team to run the sound");
  if (a.soundTech === "unsure" || a.experienced === "no") flags.push("May need help running the sound");
  if (a.fulfilment === "delivery") flags.push("Wants delivery");

  // Mics: speech mics are the people talking at the same time (or all of
  // them if we weren't told), plus one per singer. A choir is miked in
  // groups, so it's listed rather than counted.
  const counts: string[] = [];
  const speechMics = a.speakersAtOnce ?? a.speakers ?? 0;
  const vocalMics = a.vocalists ?? 0;
  if (speechMics + vocalMics > 0) {
    const parts = [
      speechMics > 0 && plural(speechMics, "speech mic"),
      vocalMics > 0 && plural(vocalMics, "vocal mic"),
    ].filter(Boolean);
    counts.push(`Microphones: about ${speechMics + vocalMics} (${parts.join(", ")})`);
  }
  if (a.activities.includes("choir") && a.choirSize) counts.push(`Choir of about ${a.choirSize}: needs choir mics`);
  if (music && a.instruments.length > 0) {
    const names = a.instruments
      .map((i) => (i === "other" && a.instrumentsOther ? a.instrumentsOther : labelOf(INSTRUMENTS, i)))
      .filter(Boolean);
    counts.push(`Instruments to plug in or mic: ${names.join(", ")}`);
  }
  if (a.activities.includes("background_music") || a.activities.includes("video") || a.activities.includes("presentations")) {
    counts.push("Needs a playback input (phone or laptop cable)");
  }

  const row = (label: string, value: string | number | undefined | null): [string, string] | null =>
    value === undefined || value === null || value === "" ? null : [label, String(value)];
  const rows = (list: ([string, string] | null)[]) => list.filter((r): r is [string, string] => r !== null);

  const sections: SummarySection[] = [
    {
      title: "The event",
      rows: rows([
        row("Type", a.eventType === "other" ? a.eventTypeOther : labelOf(EVENT_TYPES, a.eventType)),
        row("Name", a.eventName),
        row("Date", from === to ? from : `${from} to ${to}`),
        row("Time", a.startTime || a.endTime ? `${a.startTime ?? "?"} to ${a.endTime ?? "?"}` : undefined),
        row("Can set up from", a.setupTime),
        row("People", `about ${a.guests}`),
      ]),
    },
    {
      title: "The venue",
      rows: rows([
        row("Where", a.venue),
        row("Setting", labelOf(SETTINGS, a.setting)),
        row("Size", labelOf(VENUE_SIZES, a.venueSize)),
        row("Power", labelOf(YES_NO_UNSURE, a.power)),
        a.setting !== "indoor" ? row("Cover for the gear", labelOf(YES_NO_UNSURE, a.covered)) : null,
      ]),
    },
    {
      title: "What's happening",
      rows: rows([
        row("Programme", a.activities.map((x) => labelOf(ACTIVITIES, x)).join(", ")),
        row("People speaking", a.speakers),
        row("Speaking at the same time", a.speakersAtOnce),
        row("Mic type", labelOf(MIC_TYPES, a.micType)),
        row("Vocalists", a.vocalists),
        a.activities.includes("choir") ? row("Choir size", a.choirSize) : null,
      ]),
    },
  ];

  if (music) {
    sections.push({
      title: "The band",
      rows: rows([
        row(
          "Instruments",
          a.instruments.length > 0
            ? a.instruments.map((i) => (i === "other" && a.instrumentsOther ? a.instrumentsOther : labelOf(INSTRUMENTS, i))).join(", ")
            : undefined
        ),
        row("Bring their own amps", labelOf(OWN_AMPS, a.ownAmps)),
        row("Stage monitors", labelOf(YES_NO_UNSURE, a.monitors)),
      ]),
    });
  }

  sections.push(
    {
      title: "Extras and help",
      rows: rows([
        row("Projector or screen", labelOf(YES_NO_UNSURE, a.projector)),
        row("Recording or livestream", labelOf(YES_NO_UNSURE, a.recording)),
        row("Someone to run the sound", labelOf(YES_NO_UNSURE, a.soundTech)),
        row("Has run sound before", labelOf(YES_NO, a.experienced)),
        row("Collect or delivery", labelOf(FULFILMENT, a.fulfilment)),
        row("Budget", a.budget),
        row("Anything else", a.notes),
      ]),
    },
    {
      title: "Contact",
      rows: rows([row("Name", a.name), row("Email", a.email), row("Phone", a.phone), row("Organisation", a.org)]),
    }
  );

  return { flags, counts, sections: sections.filter((s) => s.rows.length > 0) };
}

/** The summary as plain text, for the order's notes. */
export function summaryText(s: HelperSummary, heading = "Sent from the event helper."): string {
  const out = [heading];
  if (s.flags.length > 0) out.push("", "Look at first:", ...s.flags.map((f) => `- ${f}`));
  if (s.counts.length > 0) out.push("", "From their answers:", ...s.counts.map((c) => `- ${c}`));
  for (const sec of s.sections) {
    out.push("", `${sec.title}:`, ...sec.rows.map(([k, v]) => `- ${k}: ${v}`));
  }
  return out.join("\n");
}
