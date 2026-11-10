import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const entry = path.join(root, "src/components/ffsa/index.tsx");

function fileText(file: string): string {
  return readFileSync(file, "utf8");
}

function resolveImport(specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(entry), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next suffix */
    }
  }
  return null;
}

describe("ffsa server entry", () => {
  const source = fileText(entry);

  it("is not a client module and does not pull the client entry", () => {
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']\.\/client["']/);
    expect(source).not.toMatch(/\bDrawer\b/);
  });

  it("only imports server modules", () => {
    const specifiers = [...source.matchAll(/from ["'](\.[^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      const file = resolveImport(specifier);
      expect(file, specifier).toBeTruthy();
      expect(fileText(file!), specifier).not.toMatch(/^\s*["']use client["']/m);
    }
  });

  it("has no Drawer import left on the server barrel", () => {
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = fileText(full);
        if (/import\s*\{[^}]*\bDrawer\b[^}]*\}\s*from\s*["']@\/components\/ffsa["']/.test(text)) {
          offenders.push(path.relative(root, full));
        }
      }
    }
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  });
});
