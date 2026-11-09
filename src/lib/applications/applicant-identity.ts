// Identity for a public school application.
//
// Real schools ask for a name and an email as ordinary questions (labels
// containing "name" or "email"). A school whose form has only the locked
// system questions (nationality, home country) asks for neither, and the
// public form used to submit anyway. The server then stored no name and
// the placeholder address unknown@applicant.local. The applicants list
// renders a missing first/last name as the words "undefined undefined".
//
// These helpers decide which built-in fields the form still has to show,
// and they are the check the public submit route runs before any insert.
// Schools that already ask the questions keep those fields — we do not add
// a second name or email box on top of them.

export const PLACEHOLDER_APPLICANT_EMAIL = "unknown@applicant.local";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IdentityQuestion = {
  label?: string | null;
  type?: string | null;
  system_key?: string | null;
};

export type IdentityAnswer = {
  question_id?: string;
  question_label?: string | null;
  answer?: string | null;
};

export type ApplicantIdentity = {
  firstName: string;
  lastName: string;
  email: string;
};

export type IdentityGaps = {
  /** School questions never ask for a name, so the form must. */
  firstName: boolean;
  lastName: boolean;
  email: boolean;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function labelOf(question: IdentityQuestion): string {
  return (question.label ?? "").trim().toLowerCase();
}

function isSystemCountry(question: IdentityQuestion): boolean {
  return question.system_key === "nationality" || question.system_key === "home_country";
}

/** A question the existing label matcher would treat as the applicant's name. */
export function questionCoversName(question: IdentityQuestion): boolean {
  if (question.type === "section_header" || isSystemCountry(question)) return false;
  const label = labelOf(question);
  if (!label.includes("name")) return false;
  if (label.includes("email")) return false;
  return true;
}

/** A question the existing matcher would treat as the applicant's email. */
export function questionCoversEmail(question: IdentityQuestion): boolean {
  if (question.type === "section_header" || isSystemCountry(question)) return false;
  if ((question.type ?? "").toLowerCase() === "email") return true;
  return labelOf(question).includes("email");
}

/**
 * Which identity fields the public form must render itself.
 * Both name boxes are missing together: a school that already has any
 * name question keeps that question and does not get a second pair.
 */
export function identityGaps(questions: IdentityQuestion[]): IdentityGaps {
  const hasName = questions.some(questionCoversName);
  const hasEmail = questions.some(questionCoversEmail);
  return { firstName: !hasName, lastName: !hasName, email: !hasEmail };
}

export function findAnswerByLabel(
  answers: IdentityAnswer[],
  patterns: string[]
): string | null {
  for (const pattern of patterns) {
    const match = answers.find((answer) => {
      const label = (answer.question_label ?? "").toLowerCase();
      return label.includes(pattern) && clean(answer.answer);
    });
    if (match) return clean(match.answer);
  }
  return null;
}

export function findAnswerByType(
  answers: IdentityAnswer[],
  questions: Array<{ id?: string; type?: string | null }>,
  type: string
): string | null {
  const ids = new Set(
    questions.filter((question) => (question.type ?? "") === type && question.id).map((question) => question.id)
  );
  const match = answers.find((answer) => answer.question_id && ids.has(answer.question_id) && clean(answer.answer));
  return match ? clean(match.answer) : null;
}

/** A stored or submitted name that is the string "undefined…" rather than a person. */
export function isUndefinedName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^undefined/i.test(trimmed);
}

export function isPlaceholderApplicantEmail(value: string): boolean {
  return value.trim().toLowerCase() === PLACEHOLDER_APPLICANT_EMAIL;
}

export function isValidApplicantEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && !isPlaceholderApplicantEmail(email) && EMAIL_RE.test(email);
}

export type IdentityResult =
  | { ok: true; identity: ApplicantIdentity }
  | { ok: false; error: string };

/**
 * First name, last name, and email for one public submission.
 * Explicit fields win when the form added them because the school had no
 * matching question. Otherwise the same label / type match the route has
 * always used, so an existing school's questions still fill the name.
 */
export function resolveApplicantIdentity(input: {
  questions: IdentityQuestion[];
  answers: IdentityAnswer[];
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
}): IdentityResult {
  const answers = Array.isArray(input.answers) ? input.answers : [];
  const questions = Array.isArray(input.questions) ? input.questions : [];

  const firstName =
    clean(input.firstName) ||
    findAnswerByLabel(answers, ["first name", "first_name"]) ||
    findAnswerByLabel(answers, ["name"]) ||
    "";
  const lastName =
    clean(input.lastName) ||
    findAnswerByLabel(answers, ["last name", "last_name", "surname"]) ||
    "";
  const email =
    clean(input.email) ||
    findAnswerByType(answers, questions, "email") ||
    findAnswerByLabel(answers, ["email"]) ||
    "";

  const gaps = identityGaps(questions);
  if (gaps.firstName && !firstName) {
    return { ok: false, error: "Please enter your first name." };
  }
  if (gaps.lastName && !lastName) {
    return { ok: false, error: "Please enter your last name." };
  }
  if (!firstName && !lastName) {
    return { ok: false, error: "Please enter your name." };
  }
  if (isUndefinedName(firstName) || isUndefinedName(lastName)) {
    return { ok: false, error: "Please enter your name." };
  }
  if (!email) {
    return { ok: false, error: "Please enter your email address." };
  }
  if (!isValidApplicantEmail(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  return { ok: true, identity: { firstName, lastName, email } };
}

/** Put the built-in answers on the saved list when the school had no such question. */
export function withIdentityAnswers(
  answers: IdentityAnswer[],
  identity: ApplicantIdentity,
  gaps: IdentityGaps
): IdentityAnswer[] {
  const next = [...answers];
  const hasId = (id: string) => next.some((answer) => answer.question_id === id);
  if (gaps.email && identity.email && !hasId("email")) {
    next.unshift({ question_id: "email", question_label: "Email", answer: identity.email });
  }
  if (gaps.lastName && identity.lastName && !hasId("last_name")) {
    next.unshift({ question_id: "last_name", question_label: "Last name", answer: identity.lastName });
  }
  if (gaps.firstName && identity.firstName && !hasId("first_name")) {
    next.unshift({ question_id: "first_name", question_label: "First name", answer: identity.firstName });
  }
  return next;
}
