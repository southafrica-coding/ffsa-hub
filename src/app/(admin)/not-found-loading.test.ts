import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/**
 * notFound() under a loading.tsx Suspense boundary is streamed as HTTP 200
 * with NEXT_HTTP_ERROR_FALLBACK in the body. The boundary is the loading
 * file in the page's own segment or any ancestor. #572 moved
 * (admin)/loading.tsx off departments for this reason; these segments follow
 * the same rule.
 */
const NOT_FOUND_SEGMENTS = [
  "src/app/(admin)/departments/layout.tsx",
  "src/app/(admin)/departments/page.tsx",
  "src/app/(admin)/contacts/[id]/page.tsx",
  "src/app/(admin)/contacts/lists/[listId]/page.tsx",
  "src/app/(admin)/contacts/imports/[id]/errors/page.tsx",
  "src/app/(admin)/okrs/[ownerId]/page.tsx",
  "src/app/(admin)/prayer-room/preview-8a/page.tsx",
  "src/app/(admin)/prayer-room/preview-36/page.tsx",
  "src/app/(admin)/events/[id]/page.tsx",
  "src/app/(admin)/events/[id]/check-in/page.tsx",
  "src/app/(admin)/events/[id]/feedback/[formId]/page.tsx",
  "src/app/(admin)/events/[id]/feedback/[formId]/responses/page.tsx",
  "src/app/(admin)/events/[id]/forms/[formId]/page.tsx",
  "src/app/(admin)/events/[id]/forms/[formId]/responses/page.tsx",
];

/** Leaf routes that still show the skeleton, because they never call notFound(). */
const SKELETON_SEGMENTS = [
  "src/app/(admin)/contacts/new/loading.tsx",
  "src/app/(admin)/contacts/duplicates/loading.tsx",
  "src/app/(admin)/contacts/event-followup/loading.tsx",
  "src/app/(admin)/contacts/import/loading.tsx",
  "src/app/(admin)/okrs/cycles/loading.tsx",
  "src/app/(admin)/events/new/loading.tsx",
];

function loadingBoundariesAbove(relFile: string): string[] {
  const hits: string[] = [];
  let dir = path.dirname(path.join(ROOT, relFile));
  const stop = path.join(ROOT, "src/app");
  while (dir.startsWith(stop)) {
    const loading = path.join(dir, "loading.tsx");
    if (existsSync(loading)) {
      hits.push(path.relative(ROOT, loading).split(path.sep).join("/"));
    }
    if (dir === stop) break;
    dir = path.dirname(dir);
  }
  return hits;
}

describe("notFound loading boundaries", () => {
  it("places no loading.tsx on or above a segment that calls notFound()", () => {
    const offenders: string[] = [];
    for (const rel of NOT_FOUND_SEGMENTS) {
      const source = readFileSync(path.join(ROOT, rel), "utf8");
      expect(source, rel).toMatch(/notFound\(/);
      for (const loading of loadingBoundariesAbove(rel)) {
        offenders.push(`${rel} <- ${loading}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the admin skeleton on leaf routes that do not call notFound()", () => {
    for (const rel of SKELETON_SEGMENTS) {
      const source = readFileSync(path.join(ROOT, rel), "utf8");
      expect(source, rel).toContain('from "../../admin-loading"');
      expect(existsSync(path.resolve(path.dirname(path.join(ROOT, rel)), "../../admin-loading.tsx"))).toBe(true);
    }
  });
});
