import { describe, expect, it } from "vitest";
import { buildChecklist, studentToDo, toReview, type ChecklistDocument, type ChecklistType } from "./checklist";

const type = (code: string, extra: Partial<ChecklistType> = {}): ChecklistType => ({
  id: code,
  code,
  label: code,
  guidance: null,
  needed_up_to_90: true,
  needed_over_90: true,
  is_conditional: false,
  is_offline: false,
  is_active: true,
  sort_order: 0,
  ...extra,
});
const doc = (typeId: string, status: ChecklistDocument["status"], at: string, id = at): ChecklistDocument => ({
  id,
  document_type_id: typeId,
  status,
  review_note: null,
  issued_on: null,
  storage_path: status === "ticked" ? null : "x",
  created_at: at,
});

const TYPES = [
  type("passport", { sort_order: 1 }),
  type("form", { sort_order: 2, is_offline: true }),
  type("yellow_fever", { sort_order: 3, is_conditional: true }),
  type("police", { sort_order: 4, needed_up_to_90: false }),
  type("old", { is_active: false }),
];

describe("visa checklist", () => {
  it("uses the short list up to 90 days and the long list beyond", () => {
    expect(buildChecklist(TYPES, [], 90).map((i) => i.type.code)).toEqual(["passport", "form", "yellow_fever"]);
    expect(buildChecklist(TYPES, [], 91).map((i) => i.type.code)).toEqual(["passport", "form", "yellow_fever", "police"]);
    expect(buildChecklist(TYPES, [], null)).toHaveLength(3);
  });

  it("the newest upload counts, and conditional types never block", () => {
    const items = buildChecklist(
      TYPES,
      [doc("passport", "needs_redo", "2026-01-01"), doc("passport", "approved", "2026-01-02"), doc("form", "ticked", "2026-01-01")],
      60
    );
    expect(items.map((i) => [i.type.code, i.state, i.blocking])).toEqual([
      ["passport", "approved", false],
      ["form", "ticked", false],
      ["yellow_fever", "missing", false],
    ]);
  });

  it("splits the student's to-do from the leader's review pile", () => {
    const items = buildChecklist(TYPES, [doc("passport", "uploaded", "2026-01-01"), doc("form", "needs_redo", "2026-01-01")], 60);
    expect(studentToDo(items).map((i) => i.type.code)).toEqual(["form"]);
    expect(toReview(items).map((i) => i.type.code)).toEqual(["passport"]);
  });
});
