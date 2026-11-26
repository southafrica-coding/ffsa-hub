import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isVisaStatus, VISA_OPEN_STATUSES, VISA_STATUSES, VISA_WAITING_ON } from "./status";

// The app's status lists must match migration 360's CHECK constraints.
const schema = readFileSync(join(process.cwd(), "supabase/migrations/360_visa_schema.sql"), "utf8");

function checkList(column: string): string[] {
  const m = schema.match(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)`));
  if (!m) throw new Error(`No CHECK for ${column}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe("visa statuses", () => {
  it("match the database", () => {
    expect([...VISA_STATUSES]).toEqual(checkList("status"));
    expect([...VISA_WAITING_ON]).toEqual(checkList("waiting_on"));
  });

  it("closed and withdrawn are the only closed statuses (one open case per student)", () => {
    expect(VISA_OPEN_STATUSES).not.toContain("closed");
    expect(VISA_OPEN_STATUSES).not.toContain("withdrawn");
    expect(VISA_OPEN_STATUSES).toHaveLength(VISA_STATUSES.length - 2);
    expect(schema).toContain("WHERE status NOT IN ('closed', 'withdrawn')");
  });

  it("recognises statuses", () => {
    expect(isVisaStatus("awaiting_legal")).toBe(true);
    expect(isVisaStatus("pending")).toBe(false);
    expect(isVisaStatus(null)).toBe(false);
  });
});
