import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

const IMPORTS_INTERNAL =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["'][^"']*(?:\/internal(?:["'/])|departments\/http)/;

const OURS = [
  "src/app/(admin)/departments/",
  "src/app/(admin)/home/",
  "src/app/(admin)/services/",
  "src/lib/departments/load.ts",
];

describe("department page boundary", () => {
  it("does not import createAdminClient from the department, home, or services pages", () => {
    const offenders: string[] = [];
    for (const file of filesUnder(path.join(ROOT, "src/app"))) {
      const rel = relative(file);
      if (!OURS.some((prefix) => rel.startsWith(prefix))) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes("createAdminClient") || text.includes("@/lib/supabase/admin")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("does not import /internal or departments/http from pages or load.ts", () => {
    const files = [
      ...filesUnder(path.join(ROOT, "src/app")).filter((file) => !relative(file).startsWith("src/app/api/")),
      path.join(ROOT, "src/lib/departments/load.ts"),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Import specifiers only: a URL such as "http://internal.local/serve"
      // (the Missio serve pages' rate-limit key) is not an import.
      if (IMPORTS_INTERNAL.test(text)) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });
});
