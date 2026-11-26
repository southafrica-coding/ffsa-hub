import { describe, expect, it } from "vitest";
import { bundleNudges } from "./copy";
import { directoryName, publicFirstName } from "./names";
import { PUBLIC_NAME_COLUMNS, toPublicAvailability } from "./public-view";
import { createRequestSchema } from "./schema";

describe("public availability view", () => {
  it("selects only a given name", () => {
    expect(PUBLIC_NAME_COLUMNS.split(",").map((column) => column.trim()).sort()).toEqual([
      "first_name",
      "preferred_name",
    ]);
  });

  it("uses the first word of the preferred name and drops everything else", () => {
    expect(publicFirstName({ preferred_name: "Sam Sample", first_name: "Samantha" })).toBe("Sam");
    expect(publicFirstName({ first_name: "Alex", preferred_name: null })).toBe("Alex");
    expect(publicFirstName({ first_name: null, preferred_name: "  " })).toBe("there");
    const view = toPublicAvailability({
      firstName: "Samantha",
      preferredName: "Sam Sample",
      serviceDates: ["2026-11-22"],
      responses: [{ serviceDate: "2026-11-22", status: "available", note: "After nine" }],
      today: "2026-11-18",
    });
    expect(view.firstName).toBe("Sam");
    expect(JSON.stringify(view)).not.toMatch(/Sample|Samantha|@|phone/);
    expect(view.dates[0]).toMatchObject({ editable: true, status: "available", note: "After nine" });
  });

  it("marks a past date read-only", () => {
    const view = toPublicAvailability({
      firstName: "Sam",
      preferredName: null,
      serviceDates: ["2026-11-15", "2026-11-22"],
      responses: [],
      today: "2026-11-18",
    });
    const past = view.dates.find((date) => date.serviceDate === "2026-11-15");
    const upcoming = view.dates.find((date) => date.serviceDate === "2026-11-22");
    expect(past?.editable).toBe(false);
    expect(upcoming?.editable).toBe(true);
  });
});

describe("directory names and nudge copy", () => {
  it("keeps the pastor-facing name and the WhatsApp greeting on the given name", () => {
    expect(directoryName({ first_name: "Sam", last_name: "Sample", preferred_name: "Sammy" })).toBe("Sam Sample");
    const text = bundleNudges(
      [{ firstName: "Sam", url: "https://hub.example.org/serve/missio/abc" }],
      ["Sunday 22 Nov"]
    );
    expect(text.count).toBe(1);
    expect(text.whatsapp).toContain("Hi Sam");
    expect(text.whatsapp).toContain("https://hub.example.org/serve/missio/abc");
    expect(text.email).toContain("Subject: Which Sundays can you serve?");
    expect(`${text.whatsapp}\n${text.email}`).not.toMatch(/@|mailto:|wa\.me|whatsapp\.com/);
  });
});

describe("create request schema", () => {
  it("rejects a date outside the range and a duplicate", () => {
    const outside = createRequestSchema.safeParse({
      startsOn: "2026-11-16",
      endsOn: "2026-11-30",
      serviceDates: ["2026-12-06"],
    });
    expect(outside.success).toBe(false);
    const duplicate = createRequestSchema.safeParse({
      startsOn: "2026-11-16",
      endsOn: "2026-11-30",
      serviceDates: ["2026-11-22", "2026-11-22"],
    });
    expect(duplicate.success).toBe(false);
  });

  it("accepts the Sundays inside a short range", () => {
    const parsed = createRequestSchema.safeParse({
      startsOn: "2026-11-16",
      endsOn: "2026-11-30",
      serviceDates: ["2026-11-29", "2026-11-22"],
    });
    expect(parsed.success).toBe(true);
  });
});
