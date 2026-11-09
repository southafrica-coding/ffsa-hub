import { describe, expect, it } from "vitest";
import { isEvangelismNotReady, presentTestimony, type TestimonyRow } from "./evangelism";

const AUTHOR = "author";
const row: TestimonyRow = {
  id: "t1",
  author_user_id: AUTHOR,
  title: "Story",
  body: "x".repeat(50),
  occurred_on: "2026-11-01",
  location_label: "Durban",
  staff_ministry_id: null,
  people_reached: 3,
  decisions: 1,
  outcome: "decision",
  consent_to_share: true,
  status: "published",
  published_at: "2026-11-02T08:00:00Z",
  published_by: "publisher",
  withheld_reason: null,
  created_at: "2026-11-01T08:00:00Z",
  updated_at: "2026-11-02T08:00:00Z",
  staff_ministries: { name: "Evangelism team" },
  evangelism_media: [
    { id: "m1", storage_path: "testimonies/author/a.jpg", content_type: "image/jpeg", size_bytes: 10, sort_order: 0 },
  ],
};

const viewer = { view: true, submit: false, publish: false };
const publisher = { view: true, submit: true, publish: true };
const names = new Map([[AUTHOR, "Thabo N"]]);
const signed = new Map([["testimonies/author/a.jpg", "https://signed.example/a"]]);

describe("presentTestimony", () => {
  it("hides author and review fields from a plain viewer", () => {
    const out = presentTestimony(row, { userId: "someone", access: viewer }, { names, signed });
    expect(out).not.toHaveProperty("author_name");
    expect(out).not.toHaveProperty("published_by");
    expect(out).not.toHaveProperty("withheld_reason");
    expect(out).not.toHaveProperty("author_user_id");
    expect(out.is_mine).toBe(false);
    expect(out.ministry_name).toBe("Evangelism team");
    expect(out.photo).toEqual({ id: "m1", url: "https://signed.example/a", content_type: "image/jpeg" });
  });

  it("shows attribution to a publisher and to the author", () => {
    expect(presentTestimony(row, { userId: "p", access: publisher }, { names }).author_name).toBe("Thabo N");
    const own = presentTestimony(row, { userId: AUTHOR, access: viewer }, { names });
    expect(own.author_name).toBe("Thabo N");
    expect(own.is_mine).toBe(true);
  });

  it("never returns a storage path, only a signed URL (or null)", () => {
    const out = presentTestimony(row, { userId: "someone", access: viewer });
    expect(out.photo?.url).toBeNull();
    expect(JSON.stringify(out)).not.toContain("testimonies/");
  });
});

describe("isEvangelismNotReady", () => {
  it("spots a missing table or bucket", () => {
    expect(isEvangelismNotReady({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isEvangelismNotReady({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isEvangelismNotReady({ message: "Bucket not found" })).toBe(true);
  });

  it("does not hide real errors", () => {
    expect(isEvangelismNotReady({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isEvangelismNotReady(null)).toBe(false);
  });
});
