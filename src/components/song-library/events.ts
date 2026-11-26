import { CHECKPOINT_LABEL, ENTRY_LABEL, PLACEMENT_LABEL, STAGE_LABEL } from "./stages";
import {
  SONG_CHECKPOINT_KINDS,
  SONG_ENTRY_POINTS,
  SONG_PLACEMENTS,
  type SongCheckpointKind,
  type SongEntryPoint,
  type SongLibraryStageEvent,
  type SongPlacement,
} from "./types";

const isPlacement = (v: unknown): v is SongPlacement => typeof v === "string" && (SONG_PLACEMENTS as readonly string[]).includes(v);
const isCheckpoint = (v: unknown): v is SongCheckpointKind =>
  typeof v === "string" && (SONG_CHECKPOINT_KINDS as readonly string[]).includes(v);
const isEntry = (v: unknown): v is SongEntryPoint => typeof v === "string" && (SONG_ENTRY_POINTS as readonly string[]).includes(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * "Where it's been" line for one event. Only known payload keys are read,
 * and only enum values or names the API resolved; free text is limited to
 * the event's own note and a checkpoint note.
 */
export function describeEvent(ev: SongLibraryStageEvent & { byName: string | null }): { title: string; via: string } {
  const by = ev.byName ? `by ${ev.byName}` : "";
  const p = ev.payload ?? {};
  let title = "Updated";
  let detail: string | null = null;
  switch (ev.kind) {
    case "stage":
      if (p.created === true) {
        title = `${STAGE_LABEL.idea_entry}${isEntry(p.entry_point) ? ` · ${ENTRY_LABEL[p.entry_point]}` : ""}`;
        detail = p.holy_spirit_interrupt === true ? "Uploaded · Holy Spirit moment noted" : "Uploaded";
      } else if (ev.to_stage) {
        title = `Moved to ${STAGE_LABEL[ev.to_stage]}`;
        if (ev.from_stage) detail = `from ${STAGE_LABEL[ev.from_stage]}`;
      }
      break;
    case "placement":
      title = "Placement changed";
      if (isPlacement(p.from) && isPlacement(p.to)) detail = `${PLACEMENT_LABEL[p.from]} → ${PLACEMENT_LABEL[p.to]}`;
      else if (isPlacement(p.to)) detail = `to ${PLACEMENT_LABEL[p.to]}`;
      break;
    case "checkpoint":
      if (isCheckpoint(p.checkpoint)) {
        title = p.revoked === true ? `${CHECKPOINT_LABEL[p.checkpoint]} undone` : `${CHECKPOINT_LABEL[p.checkpoint]}${p.done === false ? " cleared" : ""}`;
      } else title = "Checkpoint changed";
      detail = text(p.note);
      break;
    case "version": {
      const n = typeof p.n === "number" ? p.n : null;
      title = p.is_demo === true ? "Demo uploaded" : n ? `Version ${n} uploaded` : "New version";
      detail = text(p.label);
      break;
    }
    case "writer": {
      const name = text(p.display_name) ?? "A writer";
      if (p.action === "added") title = `${name} joined as co-writer`;
      else if (p.action === "removed") title = `${name} removed as writer`;
      else if (p.action === "confirmed") title = `${name} confirmed their split`;
      else if (p.action === "unconfirmed") title = `${name} withdrew their confirmation`;
      else title = "Split confirmations cleared";
      break;
    }
  }
  const via = [detail, by, text(ev.note)].filter(Boolean).join(" · ");
  return { title, via };
}
