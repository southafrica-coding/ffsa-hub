// A server component may render a client component, but can't call a plain function
// exported from a "use client" file: Next turns it into a client reference and the page
// crashes ("Application error"), which tests that render in jsdom never see. Review found
// one on the Fleet calendar (bookPrefill); this keeps Fleet and Vehicles free of them.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["app/(admin)/bookings/vehicles", "app/api/vehicles", "lib/fleet", "lib/vehicles"].map((r) => path.join(SRC, r));
const isClient = (s: string) => /^\s*(\/\/[^\n]*\n\s*)*["']use client["']/.test(s);

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

describe("server / client boundary", () => {
  it("no server file calls a function exported from a \"use client\" file", () => {
    const bad: string[] = [];
    for (const f of ROOTS.flatMap(files)) {
      const src = fs.readFileSync(f, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
        const target = resolve(f, m[2]);
        if (!target || !isClient(fs.readFileSync(target, "utf8"))) continue;
        const values = m[1]
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0])
          .filter((n) => n && !n.startsWith("type ") && /^[a-z]/.test(n));
        for (const n of values) bad.push(`${path.relative(SRC, f)} imports ${n}() from ${path.relative(SRC, target)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
