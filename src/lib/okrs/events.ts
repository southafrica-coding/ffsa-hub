// Turning recorded edits into sentences.
//
// okr_events stores the raw fact — field, old value, new value — because that
// is what a trigger can honestly capture. Phrasing belongs here, next to the
// timeline that renders it, so the database never has to guess how a change
// should read.

import type { OkrEvent } from "@/types/okrs";

const FIELD_LABEL: Record<string, string> = {
  description: "the wording",
  title: "the title",
  label: "the label",
  notes: "the notes",
  timeline: "the timeline",
  metric: "the target",
  key_result: "a key result",
};

/** How long a value can be before the timeline quotes it rather than showing it whole. */
const INLINE_MAX = 60;

function fieldLabel(field: string | null): string {
  return field ? FIELD_LABEL[field] ?? field : "this";
}

/**
 * A one-line summary of what happened, in the past tense and without the
 * actor's name — the timeline puts that alongside.
 *
 * Short values are shown inline ("the target from 150 to 180") because that is
 * the whole story. Long ones are not: a rewritten paragraph rendered as
 * "changed from <300 chars> to <300 chars>" buries the timeline, so those say
 * only that they changed and let `detail()` carry the text.
 */
export function summarise(event: OkrEvent): string {
  if (event.action === "created") return "Added this";
  if (event.action === "deleted") return `Deleted ${fieldLabel(event.field)}`;

  const label = fieldLabel(event.field);
  const from = event.old_value?.trim();
  const to = event.new_value?.trim();

  if (!from && to) return `Set ${label}`;
  if (from && !to) return `Cleared ${label}`;

  const short = (from?.length ?? 0) <= INLINE_MAX && (to?.length ?? 0) <= INLINE_MAX;
  if (short && from && to) return `Changed ${label} from ${from} to ${to}`;

  return `Changed ${label}`;
}

/**
 * The new text, when it is worth showing under the summary — i.e. when it was
 * too long to fit inline. Returns null when `summarise` already said it all,
 * so the caller can render nothing rather than repeating itself.
 */
export function detail(event: OkrEvent): string | null {
  if (event.action !== "updated") return null;

  const from = event.old_value?.trim();
  const to = event.new_value?.trim();
  if (!to) return null;

  const short = (from?.length ?? 0) <= INLINE_MAX && to.length <= INLINE_MAX;
  if (short && from) return null;
  if (!from) return null; // "Set the notes" — the notes box already shows it.

  return to;
}

/**
 * When the notes were last edited, and by whom, from the event stream.
 *
 * Derived rather than stored: okr_key_results.updated_at is useless for this
 * because the check-in trigger stamps it on every progress update, so a note
 * written in January would claim to have been edited this morning.
 */
export function lastNotesEdit(
  events: OkrEvent[]
): { at: string; actor: string | null } | null {
  const found = events.find((e) => e.field === "notes" && e.action === "updated");
  return found ? { at: found.created_at, actor: found.actor_name ?? null } : null;
}
