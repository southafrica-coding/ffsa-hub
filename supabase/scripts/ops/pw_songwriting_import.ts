// ============================================================
// Ops: import P&W songwriting trainings (Op. Dandelion sheet) — 417
// ============================================================
// DO NOT APPLY TO PROD UNTIL JACK OKs IT. This is not a migration, and
// this script never connects to a database. It turns an export of the
// sheet's year tabs into a plan (dry run, the default) and, only when
// asked, into one idempotent SQL file that a person then runs with psql.
//
// Inputs (both stay OFF the repo — they hold real names):
//   --raw=<file>     {"tabs": {"2025": "<csv>", "2026": "<csv>"}} — the
//                    tabs as CSV, exactly as Sheets read_range returns them
//   --config=<file>  nations, location → nation map, name and language
//                    aliases (see ImportConfig below)
//
// Dry run (default): prints counts, the nation mapping, the name
// normalisations, skipped rows and anything ambiguous. Writes nothing.
//   npx tsx supabase/scripts/ops/pw_songwriting_import.ts --raw=… --config=…
// Emit files (still no database):
//   … --emit-sql=<file.sql> --emit-json=<file.json>
//
// Cleanup rules: column B is dropped; months fill down; a cell that is
// just "?" is null; trainers split on "/" and ","; names and languages go
// through the alias maps; locations map to nations; rows with no counts
// at all (trained, songs, post-workshop songs) are skipped; everything
// from the "Running Total" row down is ignored.
//
// The SQL is one transaction. Natural keys: pw_nations.slug,
// pw_songwriting_trainings.import_key, pw_training_facilitators
// (training_id, display_name). Changed rows update only when they really
// differ (and trainings only while source = imported), so a second run
// inserts and updates nothing. Each statement prints its own
// inserted / updated counts.
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";

export type Continent =
  | "africa"
  | "asia"
  | "europe"
  | "north_america"
  | "south_america"
  | "oceania"
  | "antarctica";

export interface NationConfig {
  name: string;
  slug: string;
  continent: Continent | null;
  status: "active" | "tentative";
  notes?: string | null;
}

export interface ImportConfig {
  nations: NationConfig[];
  /** Lowercased, whitespace-collapsed location text → nation slug. */
  locationNations: Record<string, string>;
  /** Lowercased trainer spelling → display name. Unlisted names are kept as written. */
  nameAliases: Record<string, string>;
  /** Lowercased language spelling → language name. */
  languageAliases?: Record<string, string>;
}

export interface CleanTraining {
  import_key: string;
  year: number;
  month: number;
  location_text: string | null;
  nation_slug: string | null;
  audience_label: string | null;
  people_trained: number | null;
  songs_workshop: number | null;
  songs_post: number | null;
  notes: string | null;
  languages: string[];
  facilitators: string[];
  /** 1-based sheet row, for the report only. */
  sheet_row: number;
}

export interface SkippedRow {
  tab: string;
  sheet_row: number;
  reason: string;
  location: string | null;
}

export interface Ambiguity {
  tab: string;
  sheet_row: number;
  field: string;
  raw: string;
  resolution: string;
}

export interface ImportPlan {
  nations: NationConfig[];
  trainings: CleanTraining[];
  skipped: SkippedRow[];
  ambiguities: Ambiguity[];
  /** raw spelling → display name, for every alias actually used. */
  nameNormalisations: Record<string, string>;
  /** location text → nation slug (or null), for every location seen. */
  locationMapping: Record<string, string | null>;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** RFC 4180-ish CSV: quoted cells may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") {
      cell += c;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Trimmed text, or null for empty and for a lone "?". */
export function cellText(raw: string | undefined): string | null {
  const s = squash(raw ?? "");
  if (s === "" || s === "?") return null;
  return s;
}

export function parseMonth(raw: string | null): number | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\.$/, "").trim();
  return MONTHS[key] ?? null;
}

/** Whole non-negative number, null when empty/"?", undefined when it is text. */
export function parseCount(raw: string | null): number | null | undefined {
  if (raw === null) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return undefined;
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function splitTrainers(raw: string | null): string[] {
  if (!raw) return [];
  const body = raw.replace(/^multiple\s*:\s*/i, "");
  return body
    .split(/[/,]/)
    .map((p) => squash(p))
    .filter((p) => p !== "" && p !== "?");
}

export function parseLanguages(notes: string | null, aliases: Record<string, string>): string[] {
  if (!notes) return [];
  const m = notes.match(/languages?\s*:\s*([^.!\n]*)/i);
  if (!m) return [];
  const out: string[] = [];
  for (const part of m[1].split(",")) {
    // "Wana (2nd EVER WANA SONG)" → "Wana"
    const name = squash(part.replace(/\(.*?\)/g, ""));
    if (!name) continue;
    const canon = aliases[name.toLowerCase()] ?? name;
    if (!out.includes(canon)) out.push(canon);
  }
  return out;
}

const COL = { month: 0, /* B dropped */ location: 2, audience: 3, trainers: 4, trained: 5, songs: 6, post: 7 };

export function cleanTab(tab: string, csv: string, config: ImportConfig, plan: ImportPlan): void {
  const year = Number(tab);
  if (!Number.isInteger(year)) throw new Error(`Tab ${tab} is not a year`);
  const rows = parseCsv(csv);
  let month: number | null = null;
  const keys = new Set(plan.trainings.map((t) => t.import_key));

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sheetRow = i + 1;
    const first = squash(r[0] ?? "").toLowerCase();
    if (first.startsWith("running total")) break;
    if (r.every((c) => squash(c) === "")) continue;

    const monthCell = cellText(r[COL.month]);
    if (monthCell) {
      const m = parseMonth(monthCell);
      if (m === null) {
        plan.skipped.push({ tab, sheet_row: sheetRow, reason: `month not recognised: ${monthCell}`, location: cellText(r[COL.location]) });
        continue;
      }
      month = m;
    }

    const location = cellText(r[COL.location]);
    const audience = cellText(r[COL.audience]);
    const notesParts = r.slice(8).map((c) => cellText(c)).filter((c): c is string => c !== null);

    const counts: Array<[keyof typeof COL, string]> = [["trained", "people_trained"], ["songs", "songs_workshop"], ["post", "songs_post"]];
    const parsed: Record<string, number | null> = {};
    for (const [col, field] of counts) {
      const raw = cellText(r[COL[col]]);
      const n = parseCount(raw);
      if (n === undefined) {
        parsed[field] = null;
        notesParts.push(`${field.replace("_", " ")}: ${raw}`);
        plan.ambiguities.push({ tab, sheet_row: sheetRow, field, raw: raw ?? "", resolution: "not a number; stored as null and kept in notes" });
      } else {
        parsed[field] = n;
      }
      if (raw === null && squash(r[COL[col]] ?? "") === "?") {
        plan.ambiguities.push({ tab, sheet_row: sheetRow, field, raw: "?", resolution: "unknown; stored as null" });
      }
    }

    if (parsed.people_trained === null && parsed.songs_workshop === null && parsed.songs_post === null) {
      plan.skipped.push({ tab, sheet_row: sheetRow, reason: "no counts (trained, songs, post-workshop songs all empty)", location });
      continue;
    }
    if (month === null) {
      plan.skipped.push({ tab, sheet_row: sheetRow, reason: "no month above this row to fill down", location });
      continue;
    }

    let nationSlug: string | null = null;
    if (location) {
      const key = location.toLowerCase();
      if (key in config.locationNations) {
        nationSlug = config.locationNations[key] || null;
      } else {
        plan.ambiguities.push({ tab, sheet_row: sheetRow, field: "location", raw: location, resolution: "no nation mapping; nation left null" });
      }
      plan.locationMapping[location] = nationSlug;
    }

    const facilitators: string[] = [];
    for (const raw of splitTrainers(cellText(r[COL.trainers]))) {
      const lookup = raw.toLowerCase();
      const canon = config.nameAliases[lookup] ?? raw;
      if (canon !== raw) plan.nameNormalisations[raw] = canon;
      if (!facilitators.includes(canon)) facilitators.push(canon);
    }

    const notes = notesParts.length ? notesParts.join(" — ") : null;
    const mm = String(month).padStart(2, "0");
    const base = [`${year}-${mm}`, slugify(location ?? "none"), slugify(audience ?? "none"), slugify(facilitators.join(" ") || "none")].join("|");
    let key = base;
    for (let n = 2; keys.has(key); n++) key = `${base}#${n}`;
    if (key !== base) {
      plan.ambiguities.push({ tab, sheet_row: sheetRow, field: "import_key", raw: base, resolution: `duplicate natural key; numbered ${key}` });
    }
    keys.add(key);

    plan.trainings.push({
      import_key: key,
      year,
      month,
      location_text: location,
      nation_slug: nationSlug,
      audience_label: audience,
      people_trained: parsed.people_trained,
      songs_workshop: parsed.songs_workshop,
      songs_post: parsed.songs_post,
      notes,
      // Per note cell, so a later column never runs into the language list.
      languages: [...new Set(notesParts.flatMap((n) => parseLanguages(n, config.languageAliases ?? {})))],
      facilitators,
      sheet_row: sheetRow,
    });
  }
}

export function buildPlan(tabs: Record<string, string>, config: ImportConfig): ImportPlan {
  const plan: ImportPlan = {
    nations: config.nations,
    trainings: [],
    skipped: [],
    ambiguities: [],
    nameNormalisations: {},
    locationMapping: {},
  };
  const slugs = new Set(config.nations.map((n) => n.slug));
  for (const tab of Object.keys(tabs).filter((t) => /^\d{4}$/.test(t)).sort()) {
    cleanTab(tab, tabs[tab], config, plan);
  }
  for (const t of plan.trainings) {
    if (t.nation_slug && !slugs.has(t.nation_slug)) {
      throw new Error(`Location ${t.location_text} maps to unknown nation slug ${t.nation_slug}`);
    }
  }
  return plan;
}

function lit(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function arr(v: string[]): string {
  return v.length ? `ARRAY[${v.map(lit).join(", ")}]::text[]` : "'{}'::text[]";
}

/** One idempotent transaction. Each statement prints table, inserted, updated. */
export function toSql(plan: ImportPlan): string {
  const out: string[] = [
    "-- Generated by supabase/scripts/ops/pw_songwriting_import.ts. Needs 417.",
    "-- Run with psql only after Jack OKs it. Safe to run twice.",
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
  ];

  if (plan.nations.length) {
    out.push(
      `WITH src (name, slug, continent, status, notes) AS (VALUES\n  ${plan.nations
        .map((n) => `(${lit(n.name)}, ${lit(n.slug)}, ${lit(n.continent)}, ${lit(n.status)}, ${lit(n.notes ?? null)})`)
        .join(",\n  ")}\n), up AS (
  INSERT INTO public.pw_nations AS n (name, slug, continent, status, notes)
  SELECT name, slug, continent, status, notes FROM src
  ON CONFLICT (slug) DO UPDATE
     SET name = EXCLUDED.name, continent = EXCLUDED.continent,
         status = EXCLUDED.status, notes = EXCLUDED.notes
   WHERE (n.name, n.continent, n.status, n.notes)
         IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.continent, EXCLUDED.status, EXCLUDED.notes)
  RETURNING (xmax = 0) AS inserted
)
SELECT 'pw_nations' AS tbl, count(*) FILTER (WHERE inserted) AS inserted, count(*) FILTER (WHERE NOT inserted) AS updated FROM up;`
    );
  }

  if (plan.trainings.length) {
    const vals = plan.trainings.map(
      (t) =>
        `(${lit(t.import_key)}, ${t.year}, ${t.month}, ${lit(t.location_text)}, ${lit(t.nation_slug)}, ${lit(t.audience_label)}, ` +
        `${lit(t.people_trained)}::int, ${lit(t.songs_workshop)}::int, ${lit(t.songs_post)}::int, ${lit(t.notes)}, ${arr(t.languages)})`
    );
    out.push(
      `WITH src (import_key, year, month, location_text, nation_slug, audience_label, people_trained, songs_workshop, songs_post, notes, languages) AS (VALUES\n  ${vals.join(",\n  ")}\n), up AS (
  INSERT INTO public.pw_songwriting_trainings AS t
    (import_key, year, month, location_text, nation_id, audience_label, people_trained,
     songs_workshop, songs_post, notes, languages, status, source)
  SELECT s.import_key, s.year, s.month, s.location_text, n.id, s.audience_label, s.people_trained,
         s.songs_workshop, s.songs_post, s.notes, s.languages, 'completed', 'imported'
    FROM src s
    LEFT JOIN public.pw_nations n ON n.slug = s.nation_slug
  ON CONFLICT (import_key) DO UPDATE
     SET year = EXCLUDED.year, month = EXCLUDED.month, location_text = EXCLUDED.location_text,
         nation_id = EXCLUDED.nation_id, audience_label = EXCLUDED.audience_label,
         people_trained = EXCLUDED.people_trained, songs_workshop = EXCLUDED.songs_workshop,
         songs_post = EXCLUDED.songs_post, notes = EXCLUDED.notes, languages = EXCLUDED.languages
   WHERE t.source = 'imported'
     AND (t.year, t.month, t.location_text, t.nation_id, t.audience_label, t.people_trained,
          t.songs_workshop, t.songs_post, t.notes, t.languages)
         IS DISTINCT FROM
         (EXCLUDED.year, EXCLUDED.month, EXCLUDED.location_text, EXCLUDED.nation_id, EXCLUDED.audience_label,
          EXCLUDED.people_trained, EXCLUDED.songs_workshop, EXCLUDED.songs_post, EXCLUDED.notes, EXCLUDED.languages)
  RETURNING (xmax = 0) AS inserted
)
SELECT 'pw_songwriting_trainings' AS tbl, count(*) FILTER (WHERE inserted) AS inserted, count(*) FILTER (WHERE NOT inserted) AS updated FROM up;`
    );

    const fac = plan.trainings.flatMap((t) => t.facilitators.map((f) => `(${lit(t.import_key)}, ${lit(f)})`));
    if (fac.length) {
      out.push(
        `WITH src (import_key, display_name) AS (VALUES\n  ${fac.join(",\n  ")}\n), up AS (
  INSERT INTO public.pw_training_facilitators (training_id, display_name)
  SELECT t.id, s.display_name
    FROM src s
    JOIN public.pw_songwriting_trainings t ON t.import_key = s.import_key
  ON CONFLICT (training_id, display_name) DO NOTHING
  RETURNING 1
)
SELECT 'pw_training_facilitators' AS tbl, count(*) AS inserted, 0 AS updated FROM up;`
      );
    }
  }

  out.push("COMMIT;", "");
  return out.join("\n\n");
}

export function summarise(plan: ImportPlan): string {
  const byYear = new Map<number, { trainings: number; trained: number; songs: number; post: number }>();
  for (const t of plan.trainings) {
    const y = byYear.get(t.year) ?? { trainings: 0, trained: 0, songs: 0, post: 0 };
    y.trainings++;
    y.trained += t.people_trained ?? 0;
    y.songs += t.songs_workshop ?? 0;
    y.post += t.songs_post ?? 0;
    byYear.set(t.year, y);
  }
  const lines: string[] = ["DRY RUN — nothing written.", ""];
  lines.push(`pw_nations: ${plan.nations.length} rows`);
  lines.push(`pw_songwriting_trainings: ${plan.trainings.length} rows`);
  lines.push(`pw_training_facilitators: ${plan.trainings.reduce((n, t) => n + t.facilitators.length, 0)} rows`);
  lines.push("pw_songs / pw_song_writers: 0 rows (the sheet has counts, not song titles)", "");
  for (const [year, y] of [...byYear].sort((a, b) => a[0] - b[0])) {
    lines.push(`${year}: ${y.trainings} trainings, ${y.trained} trained, ${y.songs} workshop songs, ${y.post} post-workshop songs`);
  }
  lines.push("", "Location → nation:");
  for (const [loc, slug] of Object.entries(plan.locationMapping).sort()) lines.push(`  ${loc} → ${slug ?? "(none)"}`);
  lines.push("", `Name normalisations: ${Object.keys(plan.nameNormalisations).length}`);
  lines.push("", `Skipped: ${plan.skipped.length}`);
  for (const s of plan.skipped) lines.push(`  ${s.tab} row ${s.sheet_row} (${s.location ?? "no location"}): ${s.reason}`);
  lines.push("", `Ambiguous: ${plan.ambiguities.length}`);
  for (const a of plan.ambiguities) lines.push(`  ${a.tab} row ${a.sheet_row} ${a.field}: ${a.raw} → ${a.resolution}`);
  return lines.join("\n");
}

function arg(argv: string[], name: string): string | null {
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function main(argv: string[]): void {
  const rawPath = arg(argv, "raw");
  const configPath = arg(argv, "config");
  if (!rawPath || !configPath) {
    console.error("Usage: pw_songwriting_import.ts --raw=<sheet.json> --config=<config.json> [--emit-sql=<f>] [--emit-json=<f>]");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(rawPath, "utf8")) as { tabs: Record<string, string> };
  const config = JSON.parse(readFileSync(configPath, "utf8")) as ImportConfig;
  const plan = buildPlan(raw.tabs, config);
  console.log(summarise(plan));
  const sqlPath = arg(argv, "emit-sql");
  const jsonPath = arg(argv, "emit-json");
  if (sqlPath) {
    writeFileSync(sqlPath, toSql(plan));
    console.log(`\nWrote SQL to ${sqlPath}. Not run.`);
  }
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(plan, null, 2));
    console.log(`Wrote plan JSON to ${jsonPath}.`);
  }
}

if (process.argv[1]?.endsWith("pw_songwriting_import.ts")) {
  main(process.argv.slice(2));
}
