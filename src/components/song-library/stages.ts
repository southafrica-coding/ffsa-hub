import {
  FINISHED_STAGES,
  SONG_PLACEMENTS,
  SONG_STAGES,
  type SongCheckpointKind,
  type SongEntryPoint,
  type SongHelpCategory,
  type SongPathway,
  type SongPathwayStep,
  type SongPlacement,
  type SongStage,
} from "./types";

export const STAGE_LABEL: Record<SongStage, string> = {
  idea_entry: "Idea / Entry",
  writing: "Writing",
  set_down: "Set it down",
  refine: "Refine",
  written_needs_demo: "Written, needs demo",
  demo_ready: "Demo ready",
  share: "Share",
  celebrate: "Celebrate",
};

export const PLACEMENT_LABEL: Record<SongPlacement, string> = {
  inbox: "Inbox",
  prayer_sets: "Prayer Sets",
  ministry_nights: "Ministry Nights",
  events: "Events",
  ffsa_music: "FFSA Music",
  personal: "Personal (Devo/Balladeers)",
};

/** The main placement flow. personal sits beside it, not after it. */
export const PLACEMENT_FLOW: readonly SongPlacement[] = SONG_PLACEMENTS.filter((p) => p !== "personal");

export const CHECKPOINT_LABEL: Record<SongCheckpointKind, string> = {
  credits_splits_agreed: "Credits / splits agreed",
  prayer_room_test: "Prayer Room test",
  ministry_night_debut: "Ministry Night debut",
  event: "Event",
  recording: "Recording",
};

export const ENTRY_LABEL: Record<SongEntryPoint, string> = {
  lyric: "Lyric",
  melody: "Melody",
  instrumental: "Instrumental",
};

export const HELP_LABEL: Record<SongHelpCategory, string> = {
  vocals: "Vocals",
  keys: "Keys",
  guitar: "Guitar",
  bass: "Bass",
  drums: "Drums",
  demo_production: "Demo production",
  lyric_feedback: "Lyric feedback",
  charts: "Charts",
};

export const HELP_HINT: Record<SongHelpCategory, string> = {
  vocals: "Harmony, guide vocals",
  keys: "Piano, pads",
  guitar: "Acoustic and electric",
  bass: "",
  drums: "Kit, percussion",
  demo_production: "Recording, mixing a demo",
  lyric_feedback: "Fresh ears in Refine",
  charts: "Chord charts, lead sheets",
};

/** Stages a writer may move between on their own song (419 trigger rule). */
export const WRITER_STAGES: readonly SongStage[] = ["idea_entry", "writing", "set_down", "refine", "written_needs_demo"];

/** 1-based position, for "Stage 4 of 8". */
export function stageNumber(stage: SongStage): number {
  return SONG_STAGES.indexOf(stage) + 1;
}

export function isFinished(stage: SongStage): boolean {
  return (FINISHED_STAGES as readonly SongStage[]).includes(stage);
}

export function needsDemo(stage: SongStage): boolean {
  return stage === "written_needs_demo";
}

export type LibraryState = "finished" | "in_process" | "needs_demo";

/** The library chips. Needs demo is its own chip, not part of In process. */
export function libraryState(stage: SongStage): LibraryState {
  if (isFinished(stage)) return "finished";
  if (needsDemo(stage)) return "needs_demo";
  return "in_process";
}

/**
 * The stage a song would usually go to next. Set it down is a suggestion,
 * so from Writing the usual next step is Set it down, but Refine is just as
 * legal (see canMoveStage). Celebrate has no next stage.
 */
export function nextStage(stage: SongStage): SongStage | null {
  const i = SONG_STAGES.indexOf(stage);
  return i >= 0 && i < SONG_STAGES.length - 1 ? SONG_STAGES[i + 1] : null;
}

export type StageMover = "manager" | "writer" | "none";

/**
 * Who may move a song from one stage to another.
 *
 *  - Managers (any Prayer & Worship member) may move a song to any other
 *    stage: forwards, backwards, and skipping stages. Set it down is never
 *    required, and the bonus Refine question is not a gate.
 *  - A song's own writers may move it only among the early stages
 *    (Idea / Entry to Written, needs demo), in either direction, which also
 *    lets them skip Set it down. Demo ready and later are for managers.
 *  - Nobody else moves a stage. Moving to the same stage is not a move.
 *
 * The database (419 trigger) has the final say; this only decides what the
 * menu offers.
 */
export function canMoveStage(mover: StageMover, from: SongStage, to: SongStage): boolean {
  if (from === to) return false;
  if (mover === "manager") return true;
  if (mover === "writer") return WRITER_STAGES.includes(from) && WRITER_STAGES.includes(to);
  return false;
}

/** The stages offered in the "Move stage" menu, in board order. */
export function stageMoveOptions(mover: StageMover, from: SongStage): SongStage[] {
  return SONG_STAGES.filter((to) => canMoveStage(mover, from, to));
}

/** Placement is for managers only. */
export function canMovePlacement(mover: StageMover, from: SongPlacement, to: SongPlacement): boolean {
  return mover === "manager" && from !== to;
}

/**
 * The two pathway steps after the entry point. b1 = the remaining steps in
 * lyric, melody, instrumental order; b2 = reversed.
 */
export function pathwaySteps(entry: SongEntryPoint, pathway: SongPathway | null): SongPathwayStep[] {
  const rest = (["lyric", "melody", "instrumental"] as const).filter((s) => s !== entry);
  return pathway === "b2" ? [...rest].reverse() : [...rest];
}

export function pathwayLabel(entry: SongEntryPoint, pathway: SongPathway): string {
  return pathwaySteps(entry, pathway)
    .map((s) => ENTRY_LABEL[s])
    .join(" → ");
}
