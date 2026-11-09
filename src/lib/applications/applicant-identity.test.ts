import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_APPLICANT_EMAIL,
  applicantEmailIlikePattern,
  identityGaps,
  isValidApplicantEmail,
  resolveApplicantIdentity,
} from "./applicant-identity";

const systemOnly = [
  { label: "Nationality", type: "country", system_key: "nationality" },
  { label: "Home Country", type: "country", system_key: "home_country" },
];

const realSchool = [
  ...systemOnly,
  { id: "q-first", label: "First Name", type: "short_answer" },
  { id: "q-last", label: "Surname", type: "short_answer" },
  { id: "q-parent", label: "Parent's name", type: "short_answer" },
  { id: "q-email", label: "Email address", type: "short_answer" },
  { id: "q-pastor", label: "Pastor's email", type: "email" },
];

describe("identityGaps", () => {
  it("asks for first name, last name, and email when the school has only the system questions", () => {
    expect(identityGaps(systemOnly)).toEqual({ firstName: true, lastName: true, email: true });
  });

  it("does not add fields a school already asks for by label or email type", () => {
    expect(identityGaps(realSchool)).toEqual({ firstName: false, lastName: false, email: false });
  });

  it("treats an email-type question as the email, even without the word in the label", () => {
    expect(identityGaps([{ label: "How do we reach you?", type: "email" }]).email).toBe(false);
  });
});

describe("resolveApplicantIdentity", () => {
  it("rejects a system-only form with no name and no email, and never invents the placeholder", () => {
    const result = resolveApplicantIdentity({ questions: systemOnly, answers: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/first name/i);
      expect(result.error).not.toContain(PLACEHOLDER_APPLICANT_EMAIL);
    }
  });

  it("requires both names when the school did not ask, and a real email", () => {
    expect(
      resolveApplicantIdentity({
        questions: systemOnly,
        answers: [],
        firstName: "Ada",
        lastName: " ",
        email: "ada@example.com",
      }).ok
    ).toBe(false);

    expect(
      resolveApplicantIdentity({
        questions: systemOnly,
        answers: [],
        firstName: "Ada",
        lastName: "Lovelace",
        email: "not-an-email",
      }).ok
    ).toBe(false);

    expect(
      resolveApplicantIdentity({
        questions: systemOnly,
        answers: [],
        firstName: "Ada",
        lastName: "Lovelace",
        email: "Unknown@Applicant.Local",
      }).ok
    ).toBe(false);

    const ok = resolveApplicantIdentity({
      questions: systemOnly,
      answers: [],
      firstName: " Ada ",
      lastName: "Lovelace",
      email: "  Ada@Example.COM ",
    });
    expect(ok).toEqual({
      ok: true,
      identity: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });
  });

  it("lowercases an email taken from a question answer", () => {
    const result = resolveApplicantIdentity({
      questions: [
        { label: "Full name", type: "short_answer" },
        { id: "q-email", label: "Email", type: "email" },
      ],
      answers: [
        { question_label: "Full name", answer: "Grace Hopper" },
        { question_id: "q-email", question_label: "Email", answer: " Grace@Example.com " },
      ],
    });
    expect(result).toEqual({
      ok: true,
      identity: { firstName: "Grace Hopper", lastName: "", email: "grace@example.com" },
    });
  });

  it("rejects a name that is the word undefined", () => {
    const result = resolveApplicantIdentity({
      questions: systemOnly,
      answers: [],
      firstName: "undefined",
      lastName: "undefined",
      email: "ada@example.com",
    });
    expect(result.ok).toBe(false);
  });

  it("keeps a real school's label-matched name and email", () => {
    const result = resolveApplicantIdentity({
      questions: realSchool,
      answers: [
        { question_id: "q-first", question_label: "First Name", answer: "Ada" },
        { question_id: "q-last", question_label: "Surname", answer: "Lovelace" },
        { question_id: "q-email", question_label: "Email address", answer: "ada@example.com" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      identity: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });
  });

  it("accepts a single name question without inventing a second last-name box", () => {
    const result = resolveApplicantIdentity({
      questions: [{ label: "Full name", type: "short_answer" }, { label: "Email", type: "email" }],
      answers: [
        { question_label: "Full name", answer: "Ada Lovelace" },
        { question_label: "Email", answer: "ada@example.com" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      identity: { firstName: "Ada Lovelace", lastName: "", email: "ada@example.com" },
    });
  });

  it("rejects a blank name even when the school asked for one and it was left empty", () => {
    const result = resolveApplicantIdentity({
      questions: realSchool,
      answers: [
        { question_label: "First Name", answer: "  " },
        { question_label: "Email address", answer: "ada@example.com" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name/i);
  });
});

describe("applicantEmailIlikePattern", () => {
  it("lowercases and escapes LIKE wildcards so a mixed-case stored row still matches literally", () => {
    expect(applicantEmailIlikePattern(" Ada_Smith@Example.com ")).toBe("ada\\_smith@example.com");
    expect(applicantEmailIlikePattern("a%b@example.com")).toBe("a\\%b@example.com");
    expect(applicantEmailIlikePattern("ada@example.com")).toBe("ada@example.com");
  });
});

describe("isValidApplicantEmail", () => {
  it("refuses the placeholder and anything that is not an address", () => {
    expect(isValidApplicantEmail(PLACEHOLDER_APPLICANT_EMAIL)).toBe(false);
    expect(isValidApplicantEmail("ada@example.com")).toBe(true);
    expect(isValidApplicantEmail("ada")).toBe(false);
  });
});
