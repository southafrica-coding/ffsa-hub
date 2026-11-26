import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  SONG_CHECKPOINT_KINDS,
  SONG_HELP_CATEGORIES,
  SONG_PLACEMENTS,
  SONG_SHARE_KINDS,
  SONG_STAGES,
} from "./db.types";

// Migration 419 is applied by hand. CI does not start Postgres; the RLS
// and constraint checks run on a throwaway Postgres 17 (see the PR). These
// pin the SQL and keep the TS enums in step with its CHECKs.

const ROOT = path.resolve(__dirname, "../../..");
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/419_song_library.sql"),
  "utf8",
);
const rollback = readFileSync(
  path.join(ROOT, "supabase/rollbacks/419_song_library_rollback.sql"),
  "utf8",
);
// Executable SQL only; the header documents a follow-up FK in comments.
const code = migration.replace(/--.*$/gm, "");
const [schemaWithComments, seed] = migration.split("-- 8. Service catalogue");
// Header comments document the seed; only executable SQL must stay slug-free.
const schema = schemaWithComments.replace(/--.*$/gm, "");

function quoted(list: readonly string[]): string {
  return list.map((v) => `'${v}'`).join(", ");
}

function squash(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

describe("migration 419 song library", () => {
  it("does not mention a live Supabase project", () => {
    expect(migration + rollback).not.toMatch(/\.supabase\.co/);
    expect(migration + rollback).not.toMatch(/\b[a-z]{20}\b/);
  });

  it("names a ministry only in the seed", () => {
    expect(seed).toBeDefined();
    expect(schema).not.toMatch(/prayer_and_worship|'media'|'hulk'/);
    expect(seed).toMatch(/'prayer_and_worship', 'own',\s+'member'/);
    expect(seed).toMatch(/'prayer_and_worship', 'manage', 'member'/);
    expect(seed).toMatch(/\(NULL,\s+'use',\s+NULL,\s+true\)/);
  });

  it("registers song_library in the existing service tables", () => {
    expect(seed).toMatch(
      /INSERT INTO public\.services \(service_key, label, admin_href\)/,
    );
    expect(seed).toMatch(/'song_library', 'Song Library'/);
    expect(migration).not.toMatch(/CREATE TABLE[^;]*public\.services?\b/i);
  });

  it("keeps the TS enums in step with the CHECKs", () => {
    const sql = squash(migration);
    expect(sql).toContain(squash(`stage IN ( ${quoted(SONG_STAGES)})`));
    expect(sql).toContain(squash(`placement IN ( ${quoted(SONG_PLACEMENTS)})`));
    expect(sql).toContain(`kind IN (${quoted(SONG_SHARE_KINDS)})`);
    expect(sql).toContain(squash(`kind IN (${quoted(SONG_CHECKPOINT_KINDS)})`));
    expect(sql).toContain(
      squash(`category IN (${quoted(SONG_HELP_CATEGORIES)})`),
    );
  });

  it("revokes every helper from PUBLIC and anon, with an empty search_path", () => {
    const helpers = [
      ...migration.matchAll(
        /CREATE OR REPLACE FUNCTION public\.(song_library_\w+)\(/g,
      ),
    ].map((m) => m[1]);
    expect(helpers.length).toBeGreaterThan(20);
    const bodies = migration.split("CREATE OR REPLACE FUNCTION").slice(1);
    for (const body of bodies) {
      expect(body.slice(0, 400)).toMatch(/SET search_path = ''/);
    }
    for (const name of [
      "song_library_is_admin",
      "song_library_can_read",
      "song_library_can_manage",
      "song_library_my_song_ids",
      "song_library_storage_can_read",
      "song_library_storage_can_write",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon;`,
        ),
      );
    }
  });

  it("wraps no-argument helpers in SELECT inside policies", () => {
    const policies = migration
      .split("CREATE POLICY")
      .slice(1)
      .map((p) => p.split(";")[0]);
    expect(policies.length).toBeGreaterThan(20);
    for (const p of policies) {
      expect(p).not.toMatch(
        /(?<!\(SELECT )public\.song_library_(can_read|is_admin|can_manage)\(\)/,
      );
    }
  });

  it("never grants anon anything", () => {
    expect(code).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/);
  });

  it("keeps the bucket private (200 MB) with no overwrite policy", () => {
    expect(migration).toMatch(/'song-library',\s+'song-library',\s+false/);
    expect(code).toMatch(/\b209715200\b/);
    expect(migration).not.toMatch(/ON storage\.objects FOR (UPDATE|ALL)/);
  });

  it("enforces splits with deferred constraint triggers covering DELETE", () => {
    for (const t of ["writers", "checkpoints"]) {
      expect(code).toMatch(
        new RegExp(
          `CREATE CONSTRAINT TRIGGER song_library_${t}_splits_agreed\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.song_library_${t}\\s+DEFERRABLE INITIALLY DEFERRED`,
        ),
      );
    }
  });

  it("derives credits_splits_agreed from per-writer confirmations", () => {
    expect(code).toMatch(/confirmed_at\s+timestamptz/);
    expect(code).toMatch(/confirmed_by\s+uuid REFERENCES public\.users/);
    for (const fn of [
      "song_library_writers_before",
      "song_library_writers_after",
      "song_library_checkpoints_guard",
      "song_library_checkpoints_log",
    ]) {
      expect(code).toMatch(
        new RegExp(
          `CREATE TRIGGER ${fn} (BEFORE|AFTER) INSERT OR UPDATE OR DELETE`,
        ),
      );
    }
    expect(code).not.toMatch(/CREATE TRIGGER song_library_writers_log\b/);
    // Every credit field is locked while agreed.
    expect(code).toContain(
      "ARRAY['user_id', 'display_name', 'role', 'is_lead', 'split_pct']",
    );
    expect(code).toMatch(/AS splits_agreed\b/);
  });

  it("leaves checkpoint writes to managers and admins", () => {
    const policy = code
      .split('CREATE POLICY "Song library: write checkpoints"')[1]
      .split(";")[0];
    expect(policy).toMatch(/song_library_can_manage/);
    expect(policy).not.toMatch(/song_library_my_song_ids/);
  });

  it("lets only writers, managers and admins read celebrate notes", () => {
    const reads = [
      ...code.matchAll(
        /CREATE POLICY "([^"]+)" ON public\.song_library_celebrate_notes\s+FOR SELECT[^;]*/g,
      ),
    ];
    expect(reads.map((m) => m[1])).toEqual([
      "Song library: writers, managers and admins read celebrate notes",
    ]);
    const using = reads[0][0];
    expect(using).toMatch(/song_library_is_admin/);
    expect(using).toMatch(/song_library_can_manage/);
    expect(using).toMatch(/song_library_my_song_ids/);
    expect(using).not.toMatch(/song_library_can_read/);
    // The writer-tables loop grants read-by-all; celebrate's copy is dropped.
    expect(code).toMatch(
      /DROP POLICY IF EXISTS "Song library: read" ON public\.song_library_celebrate_notes;/,
    );
    const loopEnd = code.indexOf("$writer_tables$;");
    expect(
      code.indexOf(
        'DROP POLICY IF EXISTS "Song library: read" ON public.song_library_celebrate_notes;',
      ),
    ).toBeGreaterThan(loopEnd);
  });

  it("does not FK source_training_id to 417 yet", () => {
    expect(code).not.toMatch(/REFERENCES public\.pw_songwriting_trainings/);
    expect(code).toMatch(/source_training_id\s+uuid,/);
  });

  it("rollback refuses while songs exist and keeps a non-empty bucket", () => {
    expect(rollback).toMatch(/419 rollback refused/);
    expect(rollback).toMatch(/song_library\.rollback_drops_songs/);
    expect(rollback).toMatch(
      /DELETE FROM storage\.buckets WHERE id = 'song-library'/,
    );
    expect(rollback).toMatch(
      /DELETE FROM public\.services WHERE service_key = 'song_library'/,
    );
  });
});
