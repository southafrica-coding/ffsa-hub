import { describe, expect, it } from "vitest";
import { okrStatus } from "./ui-contract";

describe("okrStatus", () => {
  it("keeps the five database statuses and uses not_started only when the value is missing", () => {
    expect(okrStatus("complete")).toBe("complete");
    expect(okrStatus("in_progress")).toBe("in_progress");
    expect(okrStatus("moving_forward")).toBe("moving_forward");
    expect(okrStatus("not_started")).toBe("not_started");
    expect(okrStatus("stuck")).toBe("stuck");
    expect(okrStatus(null)).toBe("not_started");
    expect(okrStatus(undefined)).toBe("not_started");
    expect(okrStatus("")).toBe("not_started");
  });
});
