// Song progress that 419 keeps beside the stage: Refine answers, pathway
// steps, share steps and placement checkpoints.
//
//   PUT    /api/song-library/songs/:id/refine/:q            { checked, note? } q 1–10, 11 = bonus (writers, admins)
//   PUT    /api/song-library/songs/:id/pathway/:step        mark lyric | melody | instrumental done (writers, admins)
//   DELETE /api/song-library/songs/:id/pathway/:step        undo
//   PUT    /api/song-library/songs/:id/share/:kind          mark a share step done (writers, admins)
//   DELETE /api/song-library/songs/:id/share/:kind          undo
//   PUT    /api/song-library/songs/:id/checkpoints/:kind    { done, note? } (managers, admins)
//   DELETE /api/song-library/songs/:id/checkpoints/:kind    clear it (managers, admins)
//
// credits_splits_agreed follows the writers' sign-offs (419): it is never
// ticked by hand, and unticking it revokes the agreement and clears every
// sign-off.

import "server-only";

import { NextResponse } from "next/server";
import { canTickCheckpoint, canTickProgress } from "@/lib/song-library/access";
import { badRequest, dbError, forbidden, invalid } from "@/lib/song-library/http";
import { parseCheckpoint, parseRefine } from "@/lib/song-library/validate";
import {
  REFINE_BONUS_Q_NO,
  SL_COLUMNS,
  SL_REASONS,
  SL_TABLES,
  SONG_CHECKPOINT_KINDS,
  SONG_SHARE_KINDS,
  type Row,
} from "@/lib/song-library/types";
import { body, isLoaded, openSong, type LoadedSong } from "./shared";

const PATHWAY_STEPS = ["lyric", "melody", "instrumental"] as const;

const notWriter = () => forbidden("Only the song's writers can tick its progress", SL_REASONS.notWriter);

async function openForProgress(songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded;
  if (!canTickProgress(loaded.ctx.viewer, loaded.role)) return { response: notWriter() };
  return loaded;
}

// ── Refine ─────────────────────────────────────────────────

export async function putRefine(request: Request, songId: string, qParam: string) {
  const q = Number(qParam);
  if (!Number.isInteger(q) || q < 1 || q > REFINE_BONUS_Q_NO) return badRequest(`q must be 1 to ${REFINE_BONUS_Q_NO}`, "q_no");
  const loaded = await openForProgress(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseRefine(b.value);
  if (!parsed.ok) return invalid(parsed);
  const s = loaded.ctx.supabase;
  const existing = await s.from(SL_TABLES.refine).select(SL_COLUMNS.refine).eq("song_id", songId).eq("q_no", q).maybeSingle();
  if (existing.error) return dbError(existing.error);
  const values: Row = { checked: parsed.value.checked, ...("note" in parsed.value ? { note: parsed.value.note } : {}) };
  const write = existing.data
    ? await s.from(SL_TABLES.refine).update(values).eq("song_id", songId).eq("q_no", q).select(SL_COLUMNS.refine)
    : await s.from(SL_TABLES.refine).insert({ song_id: songId, q_no: q, ...values }).select(SL_COLUMNS.refine);
  if (write.error) return dbError(write.error);
  const item = ((write.data ?? []) as Row[])[0];
  if (!item) return notWriter();
  return NextResponse.json({ item });
}

// ── Pathway and share steps ────────────────────────────────

type StepTable = { table: string; columns: string; key: "step" | "kind"; values: readonly string[]; answer: "pathwaySteps" | "shareSteps" };
const PATHWAY: StepTable = { table: SL_TABLES.pathway, columns: SL_COLUMNS.pathway, key: "step", values: PATHWAY_STEPS, answer: "pathwaySteps" };
const SHARE: StepTable = { table: SL_TABLES.share, columns: SL_COLUMNS.share, key: "kind", values: SONG_SHARE_KINDS, answer: "shareSteps" };

async function stepsAnswer(loaded: LoadedSong, t: StepTable) {
  const r = await loaded.ctx.supabase.from(t.table).select(t.columns).eq("song_id", loaded.song.id);
  if (r.error) return dbError(r.error);
  return NextResponse.json({ [t.answer]: r.data ?? [] });
}

async function setStep(t: StepTable, songId: string, value: string, done: boolean) {
  if (!t.values.includes(value)) return badRequest(`${t.key} must be one of ${t.values.join(", ")}`, t.key);
  const loaded = await openForProgress(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const s = loaded.ctx.supabase;
  if (done) {
    const ins = await s.from(t.table).insert({ song_id: songId, [t.key]: value });
    if (ins.error && ins.error.code !== "23505") return dbError(ins.error);
  } else {
    const del = await s.from(t.table).delete().eq("song_id", songId).eq(t.key, value);
    if (del.error) return dbError(del.error);
  }
  return stepsAnswer(loaded, t);
}

export const putPathwayStep = (songId: string, step: string) => setStep(PATHWAY, songId, step, true);
export const deletePathwayStep = (songId: string, step: string) => setStep(PATHWAY, songId, step, false);
export const putShareStep = (songId: string, kind: string) => setStep(SHARE, songId, kind, true);
export const deleteShareStep = (songId: string, kind: string) => setStep(SHARE, songId, kind, false);

// ── Checkpoints ────────────────────────────────────────────

async function checkpointsAnswer(loaded: LoadedSong) {
  const r = await loaded.ctx.supabase.from(SL_TABLES.checkpoints).select(SL_COLUMNS.checkpoints).eq("song_id", loaded.song.id);
  if (r.error) return dbError(r.error);
  return NextResponse.json({ checkpoints: r.data ?? [] });
}

async function openForCheckpoint(songId: string, kind: string) {
  if (!(SONG_CHECKPOINT_KINDS as readonly string[]).includes(kind)) return { response: badRequest(`kind must be one of ${SONG_CHECKPOINT_KINDS.join(", ")}`, "kind") };
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded;
  if (!canTickCheckpoint(loaded.ctx.viewer)) return { response: forbidden("Only a Song Library manager can tick checkpoints", SL_REASONS.notManager) };
  return loaded;
}

/** Revoke credits_splits_agreed: untick it (419 then clears every sign-off). */
async function revokeAgreement(loaded: LoadedSong) {
  const up = await loaded.ctx.supabase
    .from(SL_TABLES.checkpoints)
    .update({ done_at: null })
    .eq("song_id", loaded.song.id)
    .eq("kind", "credits_splits_agreed")
    .select("song_id");
  if (up.error) return dbError(up.error);
  return checkpointsAnswer(loaded);
}

export async function putCheckpoint(request: Request, songId: string, kind: string) {
  const loaded = await openForCheckpoint(songId, kind);
  if (!isLoaded(loaded)) return loaded.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseCheckpoint(b.value);
  if (!parsed.ok) return invalid(parsed);
  if (kind === "credits_splits_agreed") {
    if (parsed.value.done || "note" in parsed.value) {
      return forbidden("Credits are agreed when every writer signs off on splits that total 100%. It can only be revoked here.", SL_REASONS.creditsDerived);
    }
    return revokeAgreement(loaded);
  }
  const s = loaded.ctx.supabase;
  const existing = await s.from(SL_TABLES.checkpoints).select("song_id").eq("song_id", songId).eq("kind", kind).maybeSingle();
  if (existing.error) return dbError(existing.error);
  const values: Row = { done_at: parsed.value.done ? new Date().toISOString() : null, ...("note" in parsed.value ? { note: parsed.value.note } : {}) };
  const write = existing.data
    ? await s.from(SL_TABLES.checkpoints).update(values).eq("song_id", songId).eq("kind", kind)
    : await s.from(SL_TABLES.checkpoints).insert({ song_id: songId, kind, ...values });
  if (write.error) return dbError(write.error);
  return checkpointsAnswer(loaded);
}

export async function deleteCheckpoint(songId: string, kind: string) {
  const loaded = await openForCheckpoint(songId, kind);
  if (!isLoaded(loaded)) return loaded.response;
  if (kind === "credits_splits_agreed") return revokeAgreement(loaded);
  const del = await loaded.ctx.supabase.from(SL_TABLES.checkpoints).delete().eq("song_id", songId).eq("kind", kind);
  if (del.error) return dbError(del.error);
  return checkpointsAnswer(loaded);
}
