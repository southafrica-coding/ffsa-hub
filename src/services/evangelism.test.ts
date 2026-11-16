import { describe, expect, it } from "vitest";
import { isEvangelismNotReady, presentTestimony, signPhotoUrls, type Attribution, type TestimonyRow } from "./evangelism";

const row: TestimonyRow = {
  id: "t1",
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
  created_at: "2026-11-01T08:00:00Z",
  updated_at: "2026-11-02T08:00:00Z",
  staff_ministries: { name: "Evangelism team" },
  evangelism_media: [{ id: "m1", content_type: "image/jpeg", size_bytes: 10, sort_order: 0 }],
};

// What evangelism_attribution() returns for each kind of caller.
const forViewer: Attribution = { id: "t1", is_mine: false, author_name: null, published_by: null, withheld_reason: null };
const forPublisher: Attribution = {
  id: "t1",
  is_mine: false,
  author_name: "Sample N",
  published_by: "publisher",
  withheld_reason: null,
};
const forAuthor: Attribution = { ...forPublisher, is_mine: true };

describe("presentTestimony", () => {
  it("carries no author or review keys for a plain viewer", () => {
    const out = presentTestimony(row, forViewer, new Map([["m1", "https://signed.example/a"]]));
    expect(out).not.toHaveProperty("author_name");
    expect(out).not.toHaveProperty("published_by");
    expect(out).not.toHaveProperty("withheld_reason");
    expect(out).not.toHaveProperty("author_user_id");
    expect(out.is_mine).toBe(false);
    expect(out.ministry_name).toBe("Evangelism team");
    expect(out.photo).toEqual({ id: "m1", url: "https://signed.example/a", content_type: "image/jpeg" });
  });

  it("shows attribution the database released to a publisher or the author", () => {
    expect(presentTestimony(row, forPublisher).author_name).toBe("Sample N");
    const own = presentTestimony(row, forAuthor);
    expect(own.author_name).toBe("Sample N");
    expect(own.is_mine).toBe(true);
  });

  it("copies withheld_by_other from attribution and never a raw id", () => {
    expect(presentTestimony(row, forAuthor)).not.toHaveProperty("withheld_by_other");
    expect(presentTestimony(row, { ...forAuthor, withheld_by_other: false })).not.toHaveProperty("withheld_by_other");
    expect(presentTestimony(row, { ...forAuthor, withheld_by_other: true }).withheld_by_other).toBe(true);
    expect(presentTestimony(row, forAuthor)).not.toHaveProperty("withheld_by");
  });

  it("shows the author their withheld reason", () => {
    const out = presentTestimony({ ...row, status: "withheld", published_at: null }, {
      ...forAuthor,
      published_by: null,
      withheld_reason: "Names a minor",
    });
    expect(out.withheld_reason).toBe("Names a minor");
  });

  it("is not mine when attribution is missing", () => {
    expect(presentTestimony(row, undefined).is_mine).toBe(false);
  });

  it("does not crash when attribution is missing for a withheld story, and offers no republish to a non-moderator", () => {
    const withheld = { ...row, status: "withheld" as const, published_at: null };
    const hidden = presentTestimony(withheld, undefined);
    expect(hidden.is_mine).toBe(false);
    expect(hidden.withheld_by_other).toBe(true);
    expect(presentTestimony(withheld, undefined, new Map(), { moderate: true })).not.toHaveProperty("withheld_by_other");
  });
});

describe("signPhotoUrls", () => {
  it("looks paths up by media id and keys the URLs by media id", async () => {
    const lookups: unknown[] = [];
    const admin = {
      from: () => ({
        select: () => ({
          in: async (_col: string, ids: string[]) => {
            lookups.push(ids);
            return { data: [{ id: "m1", storage_path: "testimonies/a/b.jpg" }] };
          },
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })),
          }),
        }),
      },
    };
    const urls = await signPhotoUrls(admin, [row]);
    expect(lookups).toEqual([["m1"]]);
    expect(urls.get("m1")).toBe("https://signed/testimonies/a/b.jpg");
  });
});

describe("isEvangelismNotReady", () => {
  it("spots a missing table, RPC or bucket", () => {
    expect(isEvangelismNotReady({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isEvangelismNotReady({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isEvangelismNotReady({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isEvangelismNotReady({ message: "Bucket not found" })).toBe(true);
  });

  it("does not hide real errors", () => {
    expect(isEvangelismNotReady({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isEvangelismNotReady(null)).toBe(false);
  });
});
