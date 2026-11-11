import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const APP = path.join(ROOT, "src/app");

/**
 * notFound() under a loading.tsx Suspense boundary is streamed as HTTP 200
 * with NEXT_HTTP_ERROR_FALLBACK in the body. The boundary is a loading file
 * in the same segment or any ancestor, and a route group is a segment even
 * though it adds nothing to the URL. On 5f144a1b, contacts/loading.tsx (and
 * the same file for events, okrs, and prayer-room) sat above those calls.
 */
const INDEX_ROUTES = [
  "src/app/(admin)/contacts/(index)",
  "src/app/(admin)/contacts/lists/(index)",
  "src/app/(admin)/events/(index)",
  "src/app/(admin)/okrs/(index)",
  "src/app/(admin)/prayer-room/(index)",
];

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function walk(dir: string, accept: (name: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, accept, found);
    else if (accept(entry)) found.push(full);
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function callsNotFound(source: string): boolean {
  const code = stripComments(source);
  const imported = /import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/.test(code);
  return imported && /\bnotFound\s*\(/.test(code);
}

/** loading.tsx in this segment or any parent, route groups included. */
function loadingAncestors(file: string): string[] {
  const hits: string[] = [];
  let dir = path.dirname(file);
  while (dir.startsWith(APP)) {
    const loading = path.join(dir, "loading.tsx");
    if (existsSync(loading)) hits.push(relative(loading));
    if (dir === APP) break;
    dir = path.dirname(dir);
  }
  return hits;
}

function dynamicDescendants(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("[")) found.push(relative(full));
    found.push(...dynamicDescendants(full));
  }
  return found;
}

describe("notFound loading boundaries", () => {
  it("places no loading.tsx on or above a segment whose page or layout calls notFound()", () => {
    const segments = walk(APP, (name) => name === "page.tsx" || name === "layout.tsx");
    const offenders: string[] = [];
    let checked = 0;
    for (const file of segments) {
      const source = readFileSync(file, "utf8");
      if (!callsNotFound(source)) continue;
      checked += 1;
      for (const loading of loadingAncestors(file)) {
        offenders.push(`${relative(file)} <- ${loading}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("gives the five index routes a loading boundary that does not wrap dynamic children", () => {
    for (const rel of INDEX_ROUTES) {
      const dir = path.join(ROOT, rel);
      const loading = path.join(dir, "loading.tsx");
      const page = path.join(dir, "page.tsx");
      expect(existsSync(page), rel).toBe(true);
      expect(existsSync(loading), rel).toBe(true);
      expect(callsNotFound(readFileSync(page, "utf8")), rel).toBe(false);
      const source = readFileSync(loading, "utf8");
      const imported = source.match(/from\s+["']([^"']+)["']/);
      expect(imported, rel).not.toBeNull();
      const target = path.resolve(dir, `${imported?.[1]}.tsx`);
      expect(existsSync(target), rel).toBe(true);
      expect(dynamicDescendants(dir), rel).toEqual([]);
      const parent = path.dirname(dir);
      expect(existsSync(path.join(parent, "page.tsx")), `${rel} left a second page behind`).toBe(false);
    }
  });

  it("keeps the admin skeleton on leaf routes that do not call notFound()", () => {
    const kept = [
      "src/app/(admin)/contacts/new/loading.tsx",
      "src/app/(admin)/contacts/duplicates/loading.tsx",
      "src/app/(admin)/contacts/event-followup/loading.tsx",
      "src/app/(admin)/contacts/import/loading.tsx",
      "src/app/(admin)/okrs/cycles/loading.tsx",
      "src/app/(admin)/events/new/loading.tsx",
    ];
    for (const rel of kept) {
      const source = readFileSync(path.join(ROOT, rel), "utf8");
      expect(source, rel).toContain('from "../../admin-loading"');
      expect(existsSync(path.resolve(path.dirname(path.join(ROOT, rel)), "../../admin-loading.tsx"))).toBe(true);
    }
  });
});
