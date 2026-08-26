import { describe, it, expect } from "vitest";
import { parseDisplayDate } from "./date-input";

describe("parseDisplayDate", () => {
  it("reads day-first dates as labelled", () => {
    expect(parseDisplayDate("16/12/2024").iso).toBe("2024-12-16");
    expect(parseDisplayDate("16/12/24").iso).toBe("2024-12-16");
  });

  // The bug that blocked a US staff member on the children gate: typed
  // month-first, stored "", and every form then reported the field blank
  // while he was looking at his own typing.
  it("rescues month-first input when day-first is impossible", () => {
    expect(parseDisplayDate("12/16/2024").iso).toBe("2024-12-16");
    expect(parseDisplayDate("03/25/2018").iso).toBe("2018-03-25");
    expect(parseDisplayDate("08/31/2026").iso).toBe("2026-08-31");
  });

  it("leaves genuinely ambiguous dates day-first", () => {
    expect(parseDisplayDate("04/03/2018").iso).toBe("2018-03-04");
  });

  it("rejects days that don't exist in the month", () => {
    expect(parseDisplayDate("31/02/2024")).toEqual({
      iso: "",
      problem: "impossible-day",
    });
    expect(parseDisplayDate("31/04/2024").problem).toBe("impossible-day");
    expect(parseDisplayDate("29/02/2023").problem).toBe("impossible-day");
    expect(parseDisplayDate("29/02/2024").iso).toBe("2024-02-29");
  });

  it("treats a half-typed date as incomplete, not wrong", () => {
    expect(parseDisplayDate("16/12/").problem).toBe("incomplete");
  });
});
