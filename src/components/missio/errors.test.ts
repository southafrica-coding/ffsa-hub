import { describe, expect, it } from "vitest";
import { missioFixedCopy } from "./errors";

const RAW = "RAW SERVER TEXT that must never render";

describe("missio fixed error copy", () => {
  it("maps every pinned code and ignores any server message", () => {
    const cases: Array<[string, number | null, string]> = [
      ["invalid_input", null, "Check the details and try again."],
      ["not_missio_person", null, "This person isn’t in Missio yet."],
      ["not_found", null, "We couldn’t find that."],
      ["already_member", null, "Already in this house."],
      ["already_resolved", null, "Someone else already updated this."],
      ["membership_not_current", null, "That membership isn’t current."],
      ["ended_at_in_future", null, "That end date is still in the future."],
      ["exists_use_search", null, "This person is already in FFSA’s contacts. Search for them and link them."],
      ["unauthenticated", null, "Sign in to continue."],
      ["forbidden", null, "Pastors only."],
      ["rate_limited", 12, "Please wait 12 seconds, then try again."],
      ["rate_limited", 1, "Please wait 1 second, then try again."],
      ["server_error", null, "That didn’t go through. Please try again."],
    ];
    for (const [code, retry, copy] of cases) {
      const text = missioFixedCopy(code, retry);
      expect(text).toBe(copy);
      expect(text).not.toContain(RAW);
      expect(text).not.toContain(code);
    }
  });

  it("uses a generic fallback for unknown codes and a missing Retry-After", () => {
    expect(missioFixedCopy("mystery_code")).toBe("That didn’t work. Please try again.");
    expect(missioFixedCopy(null)).toBe("That didn’t work. Please try again.");
    expect(missioFixedCopy(undefined)).toBe("That didn’t work. Please try again.");
    expect(missioFixedCopy("rate_limited", null)).toBe("Please wait 60 seconds, then try again.");
  });
});
