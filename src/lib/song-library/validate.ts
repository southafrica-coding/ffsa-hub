// Request body parsers. Each returns { ok, value } or { ok: false, error }.
// Limits and enums are 419's CHECKs, so a bad value is a 400 here rather
// than a database refusal.

import { isUuid } from "@/lib/departments/validate";
import {
  SONG_ENTRY_POINTS,
  SONG_HELP_CATEGORIES,
  SONG_HELP_STATUSES,
  SONG_PATHWAYS,
  SONG_PLACEMENTS,
  SONG_SUBSCRIPTION_TARGETS,
  isStage,
  type Row,
  type SongHelpCategory,
  type SongPlacement,
  type SongStage,
} from "./types";

/** A failure names the field it is about (for fieldErrors) and, rarely, its own error code. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string; code?: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string, field?: string, code?: string): Parsed<never> => ({ ok: false, error, ...(field ? { field } : {}), ...(code ? { code } : {}) });

function isObject(v: unknown): v is Row {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function unknownKeys(body: Row, allowed: readonly string[]): string | null {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  return extra.length ? `Unknown field: ${extra[0]}` : null;
}

function unknownKey(body: Row, allowed: readonly string[]): string | undefined {
  return Object.keys(body).find((k) => !allowed.includes(k));
}

type FieldRule = (v: unknown) => Parsed<unknown>;

const text = (max: number, opts: { required?: boolean; nullable?: boolean; min?: number } = {}): FieldRule => (v) => {
  if (v === null && opts.nullable) return ok(null);
  if (typeof v !== "string") return bad("must be text");
  const t = v.trim();
  if (opts.required && !t) return bad("is required");
  if (!t && opts.nullable) return ok(null);
  if (t.length > max) return bad(`must be at most ${max} characters`);
  if (opts.min && t.length < opts.min) return bad(`must be at least ${opts.min} characters`);
  return ok(t);
};
const oneOf = (list: readonly string[], nullable = false): FieldRule => (v) =>
  v === null && nullable ? ok(null) : typeof v === "string" && list.includes(v) ? ok(v) : bad(`must be one of ${list.join(", ")}`);
const bool: FieldRule = (v) => (typeof v === "boolean" ? ok(v) : bad("must be true or false"));
const intIn = (lo: number, hi: number, nullable = true): FieldRule => (v) =>
  v === null && nullable ? ok(null) : Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? ok(v) : bad(`must be a whole number from ${lo} to ${hi}`);
const uuid = (nullable = false): FieldRule => (v) => (v === null && nullable ? ok(null) : isUuid(v) ? ok(v) : bad("must be an id"));

function parseFields(body: unknown, rules: Record<string, FieldRule>, required: readonly string[] = [], opts: { nonEmpty?: boolean } = {}): Parsed<Row> {
  if (!isObject(body)) return bad("Send a JSON object");
  const extra = unknownKey(body, Object.keys(rules));
  if (extra) return bad(`Unknown field: ${extra}`, extra);
  const out: Row = {};
  for (const key of required) if (!(key in body)) return bad(`${key} is required`, key);
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in body) || body[key] === undefined) continue;
    const r = rule(body[key]);
    if (!r.ok) return bad(`${key} ${r.error}`, key);
    out[key] = r.value;
  }
  if (opts.nonEmpty && !Object.keys(out).length) return bad("Nothing to change");
  return ok(out);
}

// ── Splits ─────────────────────────────────────────────────

/** 0–100 with at most two decimals (numeric(5,2)), as hundredths. */
export function splitHundredths(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return null;
  const h = Math.round(v * 100);
  return Math.abs(v * 100 - h) < 1e-6 ? h : null;
}

const split: FieldRule = (v) => {
  if (v === null) return ok(null);
  return splitHundredths(v) === null ? bad("must be a percentage from 0 to 100 with at most two decimals") : ok(v);
};

export type SplitCheck =
  | { ok: true; totalPct: number }
  | { ok: false; totalPct: number; missing: string[]; reason: "no_writers" | "missing_split" | "not_100" };

/** Splits are complete when every writer has one and they total exactly 100.00. */
export function checkSplits(writers: readonly { id: string; split_pct: number | string | null }[]): SplitCheck {
  if (!writers.length) return { ok: false, totalPct: 0, missing: [], reason: "no_writers" };
  let total = 0;
  const missing: string[] = [];
  for (const w of writers) {
    const h = w.split_pct === null ? null : splitHundredths(Number(w.split_pct));
    if (h === null) missing.push(w.id);
    else total += h;
  }
  const totalPct = total / 100;
  if (missing.length) return { ok: false, totalPct, missing, reason: "missing_split" };
  if (total !== 10000) return { ok: false, totalPct, missing, reason: "not_100" };
  return { ok: true, totalPct };
}

export type SplitsInput = { writer_id: string; split_pct: number }[];

/** PUT /splits: every writer of the song exactly once, totalling 100.00. */
export function parseSplits(body: unknown, writerIds: readonly string[]): Parsed<SplitsInput> {
  if (!isObject(body) || !Array.isArray(body.splits)) return bad("Send { splits: [{ writer_id, split_pct }] }");
  const extra = unknownKeys(body, ["splits"]);
  if (extra) return bad(extra);
  const seen = new Set<string>();
  const out: SplitsInput = [];
  for (const s of body.splits as unknown[]) {
    if (!isObject(s) || !isUuid(s.writer_id)) return bad("Each split needs a writer_id", "writer_id");
    if (!writerIds.includes(s.writer_id)) return bad("Splits can only be given to this song's writers", "writer_id");
    if (seen.has(s.writer_id)) return bad("Each writer appears once", "writer_id");
    seen.add(s.writer_id);
    if (splitHundredths(s.split_pct) === null) return bad("split_pct must be a percentage from 0 to 100 with at most two decimals", "split_pct");
    out.push({ writer_id: s.writer_id, split_pct: s.split_pct as number });
  }
  if (writerIds.some((id) => !seen.has(id))) return bad("Give every writer on the song a split", "split_pct", "splits_not_100");
  const check = checkSplits(out.map((s) => ({ id: s.writer_id, split_pct: s.split_pct })));
  if (!check.ok) return bad(`Splits must total 100% (they total ${check.totalPct}%)`, "split_pct", "splits_not_100");
  return ok(out);
}

// ── Songs ──────────────────────────────────────────────────

const SONG_FIELDS: Record<string, FieldRule> = {
  title: text(200, { required: true }),
  entry_point: oneOf(SONG_ENTRY_POINTS),
  pathway: oneOf(SONG_PATHWAYS, true),
  holy_spirit_interrupt: bool,
  music_key: text(12, { nullable: true }),
  bpm: intIn(20, 400),
  lyrics_md: (v) => (v === null ? ok(null) : typeof v === "string" && v.length <= 20000 ? ok(v) : bad("must be text up to 20000 characters")),
  source_training_id: uuid(true),
};

export type CoWriterInput = { user_id: string | null; display_name: string | null; role: string | null };

/** A co-writer: { user_id } for a Hub user, { display_name } for anyone else, or a bare name (Hub UI's upload form). */
function parseCoWriter(v: unknown): Parsed<CoWriterInput> {
  if (typeof v === "string") {
    const name = v.trim();
    if (!name || name.length > 120) return bad("Each co-writer name is 1 to 120 characters", "co_writers");
    return ok({ user_id: null, display_name: name, role: null });
  }
  const r = parseFields(v, { user_id: uuid(true), display_name: text(120, { nullable: true }), role: text(120, { nullable: true }) });
  if (!r.ok) return r;
  const w = { user_id: (r.value.user_id as string) ?? null, display_name: (r.value.display_name as string) ?? null, role: (r.value.role as string) ?? null };
  if (!w.user_id && !w.display_name) return bad("Each co-writer needs a user_id or a display_name", "co_writers");
  return ok(w);
}

export function parseSongCreate(body: unknown, creatorId: string): Parsed<{ song: Row; coWriters: CoWriterInput[] }> {
  if (!isObject(body)) return bad("Send a JSON object");
  const { co_writers, ...rest } = body;
  const song = parseFields(rest, SONG_FIELDS, ["title", "entry_point"]);
  if (!song.ok) return song;
  const coWriters: CoWriterInput[] = [];
  if (co_writers !== undefined) {
    if (!Array.isArray(co_writers) || co_writers.length > 20) return bad("co_writers must be a list of up to 20", "co_writers");
    for (const c of co_writers) {
      const w = parseCoWriter(c);
      if (!w.ok) return { ...w, field: "co_writers" };
      if (w.value.user_id === creatorId) continue; // the uploader is the lead writer already
      if (w.value.user_id && coWriters.some((x) => x.user_id === w.value.user_id)) continue;
      if (!w.value.user_id && coWriters.some((x) => !x.user_id && x.display_name === w.value.display_name)) continue;
      coWriters.push(w.value);
    }
  }
  return ok({ song: song.value, coWriters });
}

export function parseSongPatch(body: unknown, songId: string): Parsed<Row> {
  if (isObject(body) && ("stage" in body || "placement" in body)) {
    return bad("Move a song with POST …/stage or …/placement", "stage" in body ? "stage" : "placement");
  }
  const r = parseFields(
    body,
    {
      ...SONG_FIELDS,
      chart_path: (v) =>
        v === null ? ok(null) : isChartPathFor(songId, v) ? ok(v) : bad("must be a chart uploaded to this song"),
      current_version_id: uuid(true),
    },
    [],
    { nonEmpty: true }
  );
  return r;
}

export function parseMove<T extends string>(body: unknown, isValue: (v: unknown) => v is T): Parsed<{ to: T; from: T | null; note: string | null }> {
  if (!isObject(body)) return bad("Send { to }");
  const extra = unknownKeys(body, ["to", "from", "note"]);
  if (extra) return bad(extra);
  if (!isValue(body.to)) return bad("to is not a known value", "to");
  if (body.from !== undefined && body.from !== null && !isValue(body.from)) return bad("from is not a known value", "from");
  const note = body.note === undefined || body.note === null ? null : typeof body.note === "string" && body.note.length <= 1000 ? body.note.trim() || null : undefined;
  if (note === undefined) return bad("note must be text up to 1000 characters", "note");
  return ok({ to: body.to as T, from: (body.from as T) ?? null, note });
}

export const isPlacement = (v: unknown): v is SongPlacement => typeof v === "string" && (SONG_PLACEMENTS as readonly string[]).includes(v);
export const parseStageMove = (body: unknown) => parseMove<SongStage>(body, isStage);
export const parsePlacementMove = (body: unknown) => parseMove<SongPlacement>(body, isPlacement);

// ── Uploads and versions ───────────────────────────────────

/** 419's bucket: 200 MB. */
export const SONG_UPLOAD_MAX_BYTES = 209715200;

const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
};
const CHART_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type UploadRequest = { kind: "audio" | "chart"; content_type: string; size: number; ext: string; filename: string };

export function parseUploadRequest(body: unknown): Parsed<UploadRequest> {
  if (!isObject(body)) return bad("Send { kind, filename, content_type, size }");
  const kind = body.kind ?? "audio";
  if (kind !== "audio" && kind !== "chart") return bad("kind must be audio or chart");
  const types = kind === "audio" ? AUDIO_TYPES : CHART_TYPES;
  const ct = typeof body.content_type === "string" ? body.content_type.toLowerCase() : "";
  if (!types[ct]) return bad(kind === "audio" ? "Choose an audio file (MP3, M4A, WAV, AAC, OGG, WEBM or FLAC)" : "Choose a PDF or an image", "content_type");
  if (!Number.isInteger(body.size) || (body.size as number) <= 0) return bad("size must be the file size in bytes", "size");
  if ((body.size as number) > SONG_UPLOAD_MAX_BYTES) return bad("That file is over 200 MB", "size", "too_large");
  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
  if (!filename) return bad("filename is required", "filename");
  return ok({ kind, content_type: ct, size: body.size as number, ext: types[ct], filename });
}

const UPLOAD_PATH_RE = /^([0-9a-f-]{36})\/(v|chart)-[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

/** Only paths this API handed out: {song_id}/v-{uuid}.{ext}. */
export function isVersionPathFor(songId: string, path: unknown): path is string {
  const m = typeof path === "string" ? UPLOAD_PATH_RE.exec(path) : null;
  return !!m && m[1] === songId && m[2] === "v";
}

/**
 * Only chart paths this API handed out: {song_id}/chart-{uuid}.{ext}, in
 * this song's own prefix of the song-library bucket. The pattern is anchored,
 * so a leading slash, "..", another song's prefix or a nested folder never
 * match.
 */
export function isChartPathFor(songId: string, path: unknown): path is string {
  const m = typeof path === "string" ? UPLOAD_PATH_RE.exec(path) : null;
  return !!m && m[1] === songId && m[2] === "chart";
}

export function parseVersionCreate(body: unknown, songId: string): Parsed<Row> {
  const r = parseFields(
    body,
    {
      path: (v) => (isVersionPathFor(songId, v) ? ok(v) : bad("must be an upload path for this song")),
      label: text(200, { nullable: true }),
      is_demo: bool,
      duration_s: (v) => (v === null ? ok(null) : typeof v === "number" && v >= 0 && v < 1e6 ? ok(Math.round(v * 100) / 100) : bad("must be seconds")),
    },
    ["path"]
  );
  return r;
}

export function parseVersionPatch(body: unknown): Parsed<Row> {
  return parseFields(
    body,
    {
      label: text(200, { nullable: true }),
      is_demo: bool,
      isrc: (v) => (v === null ? ok(null) : typeof v === "string" && /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(v.replace(/-/g, "").toUpperCase()) ? ok(v.replace(/-/g, "").toUpperCase()) : bad("must be a 12-character ISRC")),
    },
    [],
    { nonEmpty: true }
  );
}

// ── Writers and publishing ─────────────────────────────────

export function parseWriterCreate(body: unknown): Parsed<Row> {
  const r = parseFields(body, { user_id: uuid(true), display_name: text(120, { nullable: true }), role: text(120, { nullable: true }), split_pct: split });
  if (!r.ok) return r;
  if (!r.value.user_id && !r.value.display_name) return bad("A writer needs a user_id or a display_name");
  return r;
}

export function parseWriterPatch(body: unknown): Parsed<Row> {
  return parseFields(body, { display_name: text(120, { nullable: true }), role: text(120, { nullable: true }), split_pct: split }, [], { nonEmpty: true });
}

export function parsePublishing(body: unknown, writerIds: readonly string[]): Parsed<Row> {
  return parseFields(
    body,
    {
      ccli_no: (v) => (v === null || v === "" ? ok(null) : typeof v === "string" && /^[0-9]{1,10}$/.test(v.trim()) ? ok(v.trim()) : bad("must be up to 10 digits")),
      publisher: text(200, { nullable: true }),
      notes: text(2000, { nullable: true }),
      pro_by_writer: (v) => {
        if (!isObject(v)) return bad("must be an object keyed by writer id");
        const out: Row = {};
        for (const [id, entry] of Object.entries(v)) {
          if (!writerIds.includes(id)) return bad("keys must be this song's writers");
          if (!isObject(entry) || unknownKeys(entry, ["pro", "member_no"])) return bad("entries are { pro, member_no }");
          const pro = entry.pro == null ? null : typeof entry.pro === "string" && entry.pro.length <= 60 ? entry.pro.trim() : undefined;
          const no = entry.member_no == null ? null : typeof entry.member_no === "string" && entry.member_no.length <= 60 ? entry.member_no.trim() : undefined;
          if (pro === undefined || no === undefined) return bad("pro and member_no are text up to 60 characters");
          out[id] = { pro, member_no: no };
        }
        return ok(out);
      },
    },
    [],
    { nonEmpty: true }
  );
}

export function parseCelebrate(body: unknown): Parsed<{ body: string }> {
  const r = parseFields(body, { body: text(4000, { required: true }) }, ["body"]);
  return r.ok ? ok({ body: r.value.body as string }) : r;
}

// ── Help, helpers, subscriptions ───────────────────────────

const categories: FieldRule = (v) => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 8) return bad("must list 1 to 8 categories");
  const set = new Set<string>();
  for (const c of v) {
    if (typeof c !== "string" || !(SONG_HELP_CATEGORIES as readonly string[]).includes(c)) return bad(`must be from ${SONG_HELP_CATEGORIES.join(", ")}`);
    set.add(c);
  }
  return ok([...set]);
};

export function parseHelpCreate(body: unknown): Parsed<Row> {
  return parseFields(body, { categories, body: text(2000, { required: true }) }, ["categories", "body"]);
}

export function parseHelpPatch(body: unknown): Parsed<Row> {
  return parseFields(body, { categories, body: text(2000, { required: true }), status: oneOf(SONG_HELP_STATUSES), helper_user_id: uuid(true) }, [], { nonEmpty: true });
}

export function parseSignup(body: unknown): Parsed<{ note: string | null }> {
  if (body === null || body === undefined) return ok({ note: null });
  const r = parseFields(body, { note: text(500, { nullable: true }) });
  return r.ok ? ok({ note: (r.value.note as string) ?? null }) : r;
}

export function parseHelperCategories(body: unknown): Parsed<{ category: SongHelpCategory; note: string | null }[]> {
  if (!isObject(body) || !Array.isArray(body.categories) || body.categories.length > 8) return bad("Send { categories: [...] } (up to 8)");
  const out = new Map<string, string | null>();
  for (const c of body.categories as unknown[]) {
    const cat = typeof c === "string" ? c : isObject(c) ? c.category : null;
    const note = isObject(c) && typeof c.note === "string" ? c.note.trim().slice(0, 300) || null : null;
    if (typeof cat !== "string" || !(SONG_HELP_CATEGORIES as readonly string[]).includes(cat)) return bad(`categories must be from ${SONG_HELP_CATEGORIES.join(", ")}`);
    out.set(cat, note);
  }
  return ok([...out].map(([category, note]) => ({ category: category as SongHelpCategory, note })));
}

export function parseSubscription(body: unknown, me: string): Parsed<{ target_type: "all_uploads" | "writer"; target_user_id: string | null }> {
  const r = parseFields(body, { target_type: oneOf(SONG_SUBSCRIPTION_TARGETS), target_user_id: uuid(true) }, ["target_type"]);
  if (!r.ok) return r;
  const type = r.value.target_type as "all_uploads" | "writer";
  const target = (r.value.target_user_id as string | null | undefined) ?? null;
  if (type === "writer" && !target) return bad("A writer subscription needs target_user_id", "target_user_id");
  if (type === "all_uploads" && target) return bad("all_uploads takes no target_user_id", "target_user_id");
  if (target === me) return bad("You cannot subscribe to yourself", "target_user_id");
  return ok({ target_type: type, target_user_id: target });
}

// ── Refine, checkpoints ────────────────────────────────────

export function parseRefine(body: unknown): Parsed<{ checked: boolean; note?: string | null }> {
  const r = parseFields(body, { checked: bool, note: text(2000, { nullable: true }) }, ["checked"]);
  if (!r.ok) return r;
  return ok({ checked: r.value.checked as boolean, ...("note" in r.value ? { note: r.value.note as string | null } : {}) });
}

export function parseCheckpoint(body: unknown): Parsed<{ done: boolean; note?: string | null }> {
  const r = parseFields(body, { done: bool, note: text(500, { nullable: true }) }, ["done"]);
  if (!r.ok) return r;
  return ok({ done: r.value.done as boolean, ...("note" in r.value ? { note: r.value.note as string | null } : {}) });
}

export function parseHelperNote(body: unknown): Parsed<{ note: string | null }> {
  if (body === null || body === undefined) return ok({ note: null });
  const r = parseFields(body, { note: text(300, { nullable: true }) });
  return r.ok ? ok({ note: (r.value.note as string) ?? null }) : r;
}
