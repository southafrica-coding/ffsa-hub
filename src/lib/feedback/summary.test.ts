import { describe, it, expect } from "vitest";
import { summariseFeedback, overallScore, responsesToCsv, type ResponseRow } from "./summary";
import { validateFeedback, type FeedbackSchema } from "./schema";

const schema: FeedbackSchema = {
  version: 1,
  sections: [
    {
      id: "s1",
      title: "How it went",
      fields: [
        { id: "q_rating", type: "rating", label: "Overall?", required: true },
        { id: "q_nps", type: "nps", label: "Recommend?", required: false },
        {
          id: "q_choice",
          type: "choice",
          label: "Your area",
          required: false,
          options: ["Setup", "Worship"],
        },
        { id: "q_text", type: "long_text", label: "One change?", required: false },
      ],
    },
  ],
};

const rows: ResponseRow[] = [
  {
    id: "r1",
    respondent_name: "Sample Person 199",
    respondent_email: "t@example.com",
    answers: { q_rating: 5, q_nps: 10, q_choice: "Setup", q_text: "Start on time" },
    submitted_at: "2026-08-18T10:00:00Z",
  },
  {
    id: "r2",
    respondent_name: "Sam",
    respondent_email: "s@example.com",
    answers: { q_rating: 3, q_nps: 5, q_choice: "Setup" },
    submitted_at: "2026-08-18T11:00:00Z",
  },
  {
    id: "r3",
    respondent_name: "Lee",
    respondent_email: null,
    answers: { q_rating: 4, q_choice: "Worship", q_text: "More water" },
    submitted_at: "2026-08-18T12:00:00Z",
  },
];

describe("summariseFeedback", () => {
  const summaries = summariseFeedback(schema, rows);
  const byId = (id: string) => summaries.find((s) => s.field.id === id)!;

  it("averages a rating over the answers it actually got", () => {
    const s = byId("q_rating");
    expect(s.kind).toBe("numeric");
    if (s.kind !== "numeric") return;
    expect(s.count).toBe(3);
    expect(s.average).toBeCloseTo(4);
    // Every possible value keeps a bucket, so an empty score still draws.
    expect(s.distribution).toHaveLength(5);
    expect(s.distribution.find((d) => d.value === 5)?.count).toBe(1);
    expect(s.distribution.find((d) => d.value === 1)?.count).toBe(0);
  });

  it("scores NPS as promoters minus detractors, ignoring skips", () => {
    const s = byId("q_nps");
    if (s.kind !== "numeric") throw new Error("expected numeric");
    // Two answers: a 10 (promoter) and a 5 (detractor) → 50% − 50% = 0.
    expect(s.count).toBe(2);
    expect(s.nps).toBe(0);
  });

  it("counts choices and leaves unpicked options at zero", () => {
    const s = byId("q_choice");
    if (s.kind !== "choice") throw new Error("expected choice");
    expect(s.counts.find((c) => c.option === "Setup")?.count).toBe(2);
    expect(s.counts.find((c) => c.option === "Worship")?.count).toBe(1);
  });

  it("collects free text without the blanks", () => {
    const s = byId("q_text");
    if (s.kind !== "text") throw new Error("expected text");
    expect(s.count).toBe(2);
    expect(s.answers.map((a) => a.name)).toEqual(["Sample Person 199", "Lee"]);
  });

  it("normalises every scored question to one headline percentage", () => {
    // rating 4/5 → 75% of the 1–5 range; nps 7.5/10 → 75% of 0–10.
    expect(overallScore(summaries)).toBe(75);
  });

  it("has no headline score when nothing numeric was asked", () => {
    const textOnly: FeedbackSchema = {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "Notes",
          fields: [{ id: "q_text", type: "long_text", label: "Notes?", required: false }],
        },
      ],
    };
    expect(overallScore(summariseFeedback(textOnly, rows))).toBeNull();
  });
});

describe("responsesToCsv", () => {
  it("includes identity columns on a named form and quotes commas", () => {
    const csv = responsesToCsv(schema, rows, false);
    const [header] = csv.split("\n");
    expect(header).toContain('"Name"');
    expect(header).toContain('"Overall?"');
    expect(csv).toContain('"Sample Person 199"');
  });

  it("drops identity columns entirely on an anonymous form", () => {
    const csv = responsesToCsv(schema, rows, true);
    expect(csv).not.toContain('"Name"');
    expect(csv).not.toContain('"Sample Person 199"');
  });
});

describe("validateFeedback", () => {
  it("rejects a missing required answer", () => {
    const r = validateFeedback(schema, { q_nps: 8 });
    expect(r.valid).toBe(false);
    expect(r.errors.q_rating).toBeTruthy();
  });

  it("rejects a numeric answer outside its range", () => {
    const r = validateFeedback(schema, { q_rating: 9 });
    expect(r.valid).toBe(false);
    expect(r.errors.q_rating).toContain("between 1 and 5");
  });

  it("rejects a choice that isn't on the list", () => {
    const r = validateFeedback(schema, { q_rating: 4, q_choice: "Catering" });
    expect(r.valid).toBe(false);
    expect(r.errors.q_choice).toBeTruthy();
  });

  it("accepts a complete answer set", () => {
    expect(
      validateFeedback(schema, { q_rating: 4, q_nps: 9, q_choice: "Setup", q_text: "" }).valid
    ).toBe(true);
  });
});
