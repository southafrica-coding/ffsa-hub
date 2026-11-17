import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is no pgTAP harness and no local Supabase stack, so this does not
 * execute the function. It only checks that the migration file is in the
 * checkout and that its number is not reused by another file here.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

describe("auditorium practice migration", () => {
  it("exists once and its number prefix is unique in this checkout", () => {
    const all = readdirSync(MIGRATIONS).filter((name) => /^\d+_/.test(name));
    const ours = all.filter((name) => name.endsWith("_prayer_room_auditorium_blocks_practice.sql"));
    expect(ours).toHaveLength(1);
    const prefix = ours[0].split("_")[0];
    expect(all.filter((name) => name.startsWith(`${prefix}_`))).toEqual(ours);
  });
});
