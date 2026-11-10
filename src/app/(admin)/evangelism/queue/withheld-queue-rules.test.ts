import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const rules = readFileSync(new URL("./withheld-queue-rules.ts", import.meta.url), "utf8");

/** Names imported from the client queue-list module. Components only are safe. */
function clientImports(source: string): string[] {
  return [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']\.\/queue-list["']/g)].flatMap((match) =>
    match[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

describe("evangelism queue server boundary", () => {
  it("keeps withheld-queue rules in a module with no use client directive", () => {
    expect(rules).not.toMatch(/^\s*["']use client["']/m);
    expect(rules).toContain("export function showWithheldQueue");
    expect(rules).toContain("export const WITHHELD_QUEUE_LIMIT");
  });

  it("does not import runtime helpers from the client queue list", () => {
    expect(clientImports(page).sort()).toEqual(["QueueList", "WithheldQueue"]);
    expect(page).toMatch(/import\s*\{[^}]*showWithheldQueue[^}]*\}\s*from\s*["']\.\/withheld-queue-rules["']/);
    expect(page).toMatch(/import\s*\{[^}]*WITHHELD_QUEUE_LIMIT[^}]*\}\s*from\s*["']\.\/withheld-queue-rules["']/);
  });
});
