import { describe, expect, it } from "vitest";
import {
  SIGNATURE_MARK,
  cleanInputs,
  fillPassport,
  issueFields,
  letterParagraphs,
  letterValues,
  longDate,
  pronouns,
  renderLetter,
  templateProblems,
  templateUses,
} from "./letters";

// Made-up wording: the real letters live only in the Hub's database.
const TEMPLATE = [
  "{{letter_date}}",
  "Dear {{addressee}}",
  "{{full_name}}, passport {{passport_number}}, a citizen of {{nationality}}, is invited to {{school_name}} from {{school_start}} to {{school_end}}. {{He_She}} needs a visa from {{visa_from}} to {{visa_to}}.",
  "{{#multiple_entries}}Please grant {{him_her}} multiple entries.{{/multiple_entries}}",
  "FFSA takes responsibility for {{his_her}} repatriation.",
  "{{signature_space}}",
].join("\n\n");

const student = { first_name: "Test", last_name: "Student", gender: "Female", nationality: "Testland" };
const schools = [
  { name: "School A", start_date: "2027-01-12", end_date: "2027-04-02" },
  { name: "School A", start_date: "2027-04-05", end_date: "2027-06-30" },
];

describe("templateProblems", () => {
  it("accepts a good template", () => {
    expect(templateProblems("invitation", TEMPLATE)).toEqual([]);
  });

  it("names unknown fields and paragraphs", () => {
    expect(templateProblems("accommodation", "{{fullname}} {{#extra}}x{{/extra}}")).toEqual([
      "{{fullname}} isn't a field the Hub knows.",
      "{{#extra}} isn't a paragraph the Hub knows.",
      "{{/extra}} isn't a paragraph the Hub knows.",
    ]);
  });

  it("catches unclosed, stray and nested paragraphs", () => {
    expect(templateProblems("accommodation", "{{#outreach}} text")).toContain(
      "{{#outreach}} is never closed with {{/outreach}}."
    );
    expect(templateProblems("accommodation", "text {{/outreach}}")).toContain(
      "{{/outreach}} closes a paragraph that wasn't started."
    );
    expect(
      templateProblems("accommodation", "{{#outreach}}{{#multiple_entries}}x{{/multiple_entries}}{{/outreach}}")
    ).toContain("{{#multiple_entries}} starts inside {{#outreach}}; close that first.");
  });

  it("catches broken braces", () => {
    expect(templateProblems("accommodation", "Dear {{full_name}")).toContain(
      "Some {{ }} braces don't make a field. Check for typos."
    );
  });

  it("needs the repatriation undertaking on an invitation only", () => {
    expect(templateProblems("invitation", "Dear {{full_name}}")).toEqual([
      "An invitation letter must include FFSA's repatriation undertaking.",
    ]);
    expect(templateProblems("accommodation", "Dear {{full_name}}")).toEqual([]);
  });
});

describe("filling a letter in", () => {
  const values = letterValues({
    letterDate: "2026-11-24",
    student,
    stay: { from: "2027-01-10", to: "2027-07-02" },
    schools,
    inputs: { addressee: "The Ambassador" },
  });

  it("works out the values", () => {
    expect(values.letter_date).toBe("24 November 2026");
    expect(values.full_name).toBe("Test Student");
    expect(values.He_She).toBe("She");
    expect(values.school_name).toBe("School A");
    expect(values.school_start).toBe("12 January 2027");
    expect(values.school_end).toBe("30 June 2027");
    expect(values.visa_from).toBe("10 January 2027");
    expect(values.passport_number).toBe("{{passport_number}}");
  });

  it("keeps the passport token, drops unticked paragraphs", () => {
    const { text, missing } = renderLetter(TEMPLATE, values, { addressee: "The Ambassador" });
    expect(missing).toEqual([]);
    expect(text).toContain("passport {{passport_number}},");
    expect(text).not.toContain("multiple entries");
    expect(text).not.toMatch(/\n{3,}/);
    expect(text.endsWith(SIGNATURE_MARK)).toBe(true);
  });

  it("keeps ticked paragraphs and fills fields inside them", () => {
    const { text } = renderLetter(TEMPLATE, values, { addressee: "The Ambassador", multiple_entries: true });
    expect(text).toContain("Please grant her multiple entries.");
  });

  it("lists fields with no value", () => {
    const empty = letterValues({ letterDate: "2026-11-24", student, stay: { from: null, to: null }, schools: [], inputs: {} });
    expect(renderLetter(TEMPLATE, empty, {}).missing).toEqual([
      "addressee",
      "school_name",
      "school_start",
      "school_end",
      "visa_from",
      "visa_to",
    ]);
  });

  it("lets legal change the visa dates", () => {
    const v = letterValues({
      letterDate: "2026-11-24",
      student,
      stay: { from: "2027-01-10", to: "2027-07-02" },
      schools,
      inputs: { visa_from: "2027-02-01", visa_to: "2027-12-15" },
    });
    expect([v.visa_from, v.visa_to]).toEqual(["1 February 2027", "15 December 2027"]);
  });

  it("joins several schools", () => {
    const v = letterValues({
      letterDate: "2026-11-24",
      student,
      stay: { from: null, to: null },
      schools: [
        { name: "School A", start_date: null, end_date: null },
        { name: "School B", start_date: null, end_date: null },
        { name: "School C", start_date: null, end_date: null },
      ],
      inputs: {},
    });
    expect(v.school_name).toBe("School A, School B and School C");
  });
});

describe("helpers", () => {
  it("pronouns", () => {
    expect(pronouns("Male")).toEqual({ he_she: "he", his_her: "his", him_her: "him" });
    expect(pronouns(null).he_she).toBe("they");
  });

  it("longDate", () => {
    expect(longDate("2027-03-01")).toBe("1 March 2027");
    expect(longDate("not a date")).toBe("");
    expect(longDate(null)).toBe("");
  });

  it("fills the passport in, or says it's missing", () => {
    expect(fillPassport("No. {{passport_number}}.", "XT1")).toBe("No. XT1.");
    expect(fillPassport("No. {{passport_number}}.", null)).toBe("No. [passport number missing].");
  });

  it("splits paragraphs on blank lines", () => {
    expect(letterParagraphs("One\nline two\n\n\nTwo  \n\n")).toEqual(["One\nline two", "Two"]);
  });

  it("templateUses and issueFields", () => {
    expect(templateUses(TEMPLATE).sections).toEqual(["multiple_entries"]);
    const { fields, sections } = issueFields(TEMPLATE);
    expect(fields.map((f) => f.key)).toEqual(["visa_from", "visa_to", "addressee"]);
    expect(sections.map((s) => s.key)).toEqual(["multiple_entries"]);
  });

  it("cleanInputs keeps known keys only", () => {
    expect(cleanInputs({ addressee: " The Ambassador ", outreach: true, graduation: "" })).toEqual({
      inputs: { addressee: "The Ambassador", outreach: true },
    });
    expect(cleanInputs({ passport_number: "X" })).toEqual({ error: "Unknown field: passport_number" });
    expect(cleanInputs({ full_name: "Someone else" })).toEqual({ error: "Unknown field: full_name" });
    expect(cleanInputs({ graduation: "soon" })).toEqual({ error: "Graduation must be a date" });
    expect(cleanInputs({ outreach: "yes" })).toEqual({ error: "outreach must be true or false" });
    expect(cleanInputs(null)).toEqual({ inputs: {} });
  });
});
