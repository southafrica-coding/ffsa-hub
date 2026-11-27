// The training form's draft and its conversion to TrainingInput. Pure, so
// the month / training_date rule (424) is tested without a browser.

import { isIsoDate } from "@/lib/departments/validate";
import type { PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";
import type { TrainingInput } from "./types";

export type TrainingDraft = {
  audience_label: string;
  month: string; // YYYY-MM
  /** YYYY-MM-DD, optional. Saved as training_date; must fall in `month`. */
  training_date: string;
  location_text: string;
  nation_id: string;
  facilitators: string[];
  people_trained: string;
  songs_workshop: string;
  songs_post: string;
  languages: string[];
  notes: string;
  tentative: boolean;
};

/** A date-only YYYY-MM-DD from whatever the API stored (never shifts the day). */
export function dateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : "";
}

export function toDraft(t: PwSongwritingTraining | null, facilitators: readonly PwTrainingFacilitator[]): TrainingDraft {
  return {
    audience_label: t?.audience_label ?? "",
    month: t ? `${t.year}-${String(t.month).padStart(2, "0")}` : "",
    training_date: dateOnly(t?.training_date),
    location_text: t?.location_text ?? "",
    nation_id: t?.nation_id ?? "",
    facilitators: facilitators.map((f) => f.display_name),
    people_trained: t?.people_trained == null ? "" : String(t.people_trained),
    songs_workshop: t?.songs_workshop == null ? "" : String(t.songs_workshop),
    songs_post: t?.songs_post == null ? "" : String(t.songs_post),
    languages: t?.languages ?? [],
    notes: t?.notes ?? "",
    tentative: t?.status === "draft",
  };
}

/** Blank = unknown (null). Otherwise a whole number 0 or more. */
export function parseCount(value: string): number | null | "invalid" {
  const v = value.trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return "invalid";
  return Number(v);
}

/** "YYYY-MM" → { year, month }, or null when it isn't a month. */
export function parseMonth(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/**
 * The optional date against the chosen month (424's CHECK). Blank is fine
 * (month only). A set date must be a real YYYY-MM-DD inside year/month.
 */
export function checkTrainingDate(date: string, year: number, month: number): "ok" | "invalid" | "outside_month" {
  const d = date.trim();
  if (!d) return "ok";
  if (!isIsoDate(d)) return "invalid";
  const [y, m] = d.split("-").map(Number);
  return y === year && m === month ? "ok" : "outside_month";
}

/** The month a date sits in, as "YYYY-MM", for prefilling an empty month. */
export function monthOfDate(date: string): string {
  return isIsoDate(date.trim()) ? date.trim().slice(0, 7) : "";
}

export function toInput(d: TrainingDraft): { input: TrainingInput } | { fields: string[] } {
  const fields: string[] = [];
  const ym = parseMonth(d.month);
  if (!d.audience_label.trim()) fields.push("audience_label");
  if (!ym) fields.push("month");
  if (ym && checkTrainingDate(d.training_date, ym.year, ym.month) !== "ok") fields.push("training_date");
  if (!ym && d.training_date.trim() && !isIsoDate(d.training_date.trim())) fields.push("training_date");
  const trained = parseCount(d.people_trained);
  const workshop = parseCount(d.songs_workshop);
  const post = parseCount(d.songs_post);
  if (trained === "invalid") fields.push("people_trained");
  if (workshop === "invalid") fields.push("songs_workshop");
  if (post === "invalid") fields.push("songs_post");
  if (fields.length || !ym) return { fields };
  return {
    input: {
      audience_label: d.audience_label.trim(),
      year: ym.year,
      month: ym.month,
      // Always sent: a moved month carries its new date or null, never the old one.
      training_date: d.training_date.trim() || null,
      location_text: d.location_text.trim() || null,
      nation_id: d.nation_id || null,
      people_trained: trained as number | null,
      songs_workshop: workshop as number | null,
      songs_post: post as number | null,
      languages: d.languages.map((l) => l.trim()).filter(Boolean),
      notes: d.notes.trim() || null,
      status: d.tentative ? "draft" : "completed",
      facilitators: d.facilitators,
    },
  };
}
