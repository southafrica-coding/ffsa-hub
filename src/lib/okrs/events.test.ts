import { describe, expect, it } from "vitest";

import { detail, lastNotesEdit, summarise } from "./events";
import type { OkrEvent } from "@/types/okrs";

function event(over: Partial<OkrEvent> = {}): OkrEvent {
  return {
    id: "e1",
    key_result_id: "k1",
    objective_id: null,
    action: "updated",
    field: "description",
    old_value: null,
    new_value: null,
    actor_id: "u1",
    created_at: "2026-08-01T10:00:00Z",
    ...over,
  };
}

describe("summarise", () => {
  it("names creation and deletion plainly", () => {
    expect(summarise(event({ action: "created" }))).toBe("Added this");
    expect(summarise(event({ action: "deleted", field: "key_result" }))).toBe(
      "Deleted a key result"
    );
  });

  it("shows both sides inline when they are short", () => {
    expect(
      summarise(event({ field: "metric", old_value: "0 → 150", new_value: "0 → 180" }))
    ).toBe("Changed the target from 0 → 150 to 0 → 180");
  });

  it("omits both sides when the values are long", () => {
    // A rewritten paragraph shown in full would bury every other entry.
    const long = "x".repeat(120);
    expect(summarise(event({ old_value: long, new_value: long + "!" }))).toBe(
      "Changed the wording"
    );
  });

  it("distinguishes setting from changing from clearing", () => {
    expect(summarise(event({ field: "notes", old_value: null, new_value: "hi" }))).toBe(
      "Set the notes"
    );
    expect(summarise(event({ field: "notes", old_value: "hi", new_value: null }))).toBe(
      "Cleared the notes"
    );
  });

  it("falls back to the raw field name rather than inventing one", () => {
    expect(summarise(event({ field: "something_new", old_value: "a", new_value: "b" }))).toBe(
      "Changed something_new from a to b"
    );
  });
});

describe("detail", () => {
  it("returns nothing when the summary already said it all", () => {
    expect(detail(event({ field: "metric", old_value: "0 → 150", new_value: "0 → 180" }))).toBeNull();
  });

  it("returns the new text when it was too long to fit inline", () => {
    const long = "x".repeat(120);
    expect(detail(event({ old_value: "short", new_value: long }))).toBe(long);
  });

  it("returns nothing for a first-time set, since the field itself shows it", () => {
    expect(detail(event({ field: "notes", old_value: null, new_value: "x".repeat(120) }))).toBeNull();
  });

  it("returns nothing for creation or deletion", () => {
    expect(detail(event({ action: "created", new_value: "x" }))).toBeNull();
    expect(detail(event({ action: "deleted", old_value: "x" }))).toBeNull();
  });
});

describe("lastNotesEdit", () => {
  it("finds the most recent notes edit, ignoring other fields", () => {
    // The list arrives newest-first from the API, so the first match wins.
    const events = [
      event({ id: "e3", field: "description", created_at: "2026-08-03T00:00:00Z" }),
      event({
        id: "e2",
        field: "notes",
        created_at: "2026-08-02T00:00:00Z",
        actor_name: "Ally",
      }),
      event({ id: "e1", field: "notes", created_at: "2026-08-01T00:00:00Z" }),
    ];
    expect(lastNotesEdit(events)).toEqual({ at: "2026-08-02T00:00:00Z", actor: "Ally" });
  });

  it("returns null when the notes have never been edited", () => {
    expect(lastNotesEdit([event({ field: "description" })])).toBeNull();
  });
});
