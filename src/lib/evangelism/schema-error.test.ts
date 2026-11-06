import { describe, expect, it } from "vitest";
import { isEvangelismNotReady } from "./schema-error";

describe("isEvangelismNotReady", () => {
  it("recognises a missing table and a missing bucket", () => {
    expect(isEvangelismNotReady({ code: "PGRST205", message: "evangelism_testimonies" })).toBe(true);
    expect(isEvangelismNotReady({ code: "42P01", message: 'relation "evangelism_media" does not exist' })).toBe(true);
    expect(isEvangelismNotReady({ message: "Bucket not found" })).toBe(true);
    expect(isEvangelismNotReady({ message: "duplicate key value" })).toBe(false);
    expect(isEvangelismNotReady(null)).toBe(false);
  });
});
