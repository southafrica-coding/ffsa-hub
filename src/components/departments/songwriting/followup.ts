import type { PwSongwritingTraining } from "@/lib/departments/db.types";
import { isCompleted, newestFirst } from "./overview";
import type { LeadStatus, SongwritingLead } from "./types";

export interface PostSongRow {
  training: PwSongwritingTraining;
  /** null = the sheet says there were songs after but not how many. */
  known: number | null;
  logged: number;
}

/**
 * Trainings with songs written after the workshop: songs_post > 0, or
 * songs_post unknown (null). Newest first. logged = Song Library songs whose
 * source training is this one.
 */
export function postSongRows(
  trainings: readonly PwSongwritingTraining[],
  libraryByTraining: Record<string, number>
): PostSongRow[] {
  return trainings
    .filter((t) => isCompleted(t) && (t.songs_post == null || t.songs_post > 0))
    .sort(newestFirst)
    .map((t) => ({ training: t, known: t.songs_post, logged: libraryByTraining[t.id] ?? 0 }));
}

export function postSongSummary(rows: readonly PostSongRow[]): { known: number; logged: number } {
  return {
    known: rows.reduce((acc, r) => acc + (r.known ?? 0), 0),
    logged: rows.reduce((acc, r) => acc + r.logged, 0),
  };
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  to_contact: "To contact",
  waiting: "Waiting",
  connected: "Connected",
  closed: "Closed",
};

export const LEAD_STATUS_TONE: Record<LeadStatus, "red" | "amber" | "plain" | "green"> = {
  new: "red",
  to_contact: "amber",
  waiting: "plain",
  connected: "green",
  closed: "plain",
};

const LEAD_ORDER: Record<LeadStatus, number> = { to_contact: 0, new: 1, waiting: 2, connected: 3, closed: 4 };

/** Open leads first (to contact, new, waiting), then the rest. */
export function sortLeads(leads: readonly SongwritingLead[]): SongwritingLead[] {
  return [...leads].sort((a, b) => LEAD_ORDER[a.status] - LEAD_ORDER[b.status] || b.updated_at.localeCompare(a.updated_at));
}

/** Upload link for "Log song": the library upload, tied to the training. */
export function logSongHref(uploadHref: string, trainingId: string): string {
  return `${uploadHref}?source_training_id=${encodeURIComponent(trainingId)}`;
}

export function initial(name: string | null): string {
  const letter = name?.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}
