// FFSA Hub — Applicant-facing copy about reference completeness.
//
// An application is only actionable once every reference is in, but the
// applicant used to have no way of knowing that: the apply form said only
// "they'll get an email", and the success screen promised we'd "get back to
// you soon". This module is the single source of that wording so the apply
// forms, the post-submit screens, and the status tracker all say the same
// thing in the same register.
//
// Deliberately dependency-free — client components import it too.
//
// The number of required references is per program (reference_slots), so
// every phrase here is count-aware rather than assuming two.

/** "your reference" / "both references" / "all 3 references" */
export function referenceCountPhrase(n: number): string {
  if (n <= 1) return "your reference";
  if (n === 2) return "both references";
  return `all ${n} references`;
}

/** "your reference" / "both of your references" / "all 3 of your references" */
export function referenceCountPossessive(n: number): string {
  if (n <= 1) return "your reference";
  if (n === 2) return "both of your references";
  return `all ${n} of your references`;
}

/** Verb agreement for the phrase above. */
export function referenceCountVerb(n: number): "has" | "have" {
  return n <= 1 ? "has" : "have";
}

/** Present-tense agreement, for "…once {phrase} {are} in". */
export function referenceCountIsAre(n: number): "is" | "are" {
  return n <= 1 ? "is" : "are";
}

/**
 * The heads-up shown on the apply form, before the applicant has picked
 * their referees — so they know the application hangs on them.
 */
export function referenceHeadsUpNote(requiredCount: number): string {
  const phrase = referenceCountPhrase(requiredCount);
  const verb = referenceCountVerb(requiredCount);
  const referees = requiredCount <= 1 ? "your referee a heads-up" : "your referees a heads-up";
  return `Just so you know: your application is only complete once ${phrase} ${verb} come in. We'll only be able to review it — and get back to you — after that, so it's worth giving ${referees}.`;
}

/**
 * The confirmation shown immediately after submitting, when the applicant
 * has listed references. Replaces the old "we'll get back to you soon".
 */
export function referenceSubmittedNote(count: number): string {
  const phrase = referenceCountPhrase(count);
  const verb = referenceCountVerb(count);
  const pronoun = count <= 1 ? "it's" : "they're";
  return `Your application is complete once ${phrase} ${verb} been submitted. We'll only be able to review it once ${pronoun} in, so you may not hear from us until then.`;
}

export type ReferenceCompleteness = {
  tone: "pending" | "complete";
  title: string;
  body: string;
};

/**
 * The status tracker's headline banner, derived from LIVE reference counts —
 * never from application_responses.status, which staff move by hand and which
 * therefore lags behind the references actually arriving.
 *
 * Returns null when there is nothing to say (a program with no reference
 * slots). Callers suppress it themselves once a decision or interview stage
 * has been reached — see the status tracker page.
 */
export function referenceCompleteness({
  total,
  submitted,
  missingLabels,
}: {
  /** reference_requests rows for this application. */
  total: number;
  /** …of which have status 'submitted'. */
  submitted: number;
  /** Required slots the applicant never supplied details for. */
  missingLabels: string[];
}): ReferenceCompleteness | null {
  if (missingLabels.length > 0) {
    const labels = formatList(missingLabels);
    const plural = missingLabels.length > 1;
    return {
      tone: "pending",
      title: "We still need your reference details",
      body:
        `Your application isn't complete until we have your ${labels}. ` +
        `Add ${plural ? "each name and email" : "their name and email"} below and ` +
        `we'll send them a short form — nothing else is needed from you.`,
    };
  }

  if (total === 0) return null;

  if (submitted < total) {
    const outstanding = total - submitted;
    const phrase = referenceCountPhrase(total);
    const areIs = referenceCountIsAre(total);
    return {
      tone: "pending",
      title: `Almost there — ${submitted} of ${total} ${total === 1 ? "reference" : "references"} received`,
      body:
        `Just so you know, we'll only be able to review your application once ${phrase} ${areIs} in, ` +
        `so you may not hear from us until then. ` +
        `Your ${outstanding === 1 ? "referee has" : "referees have"} been emailed a link — nothing else is needed from you.`,
    };
  }

  return {
    tone: "complete",
    title:
      total === 1
        ? "Your reference is in — your application is complete"
        : "All references received — your application is complete",
    body:
      "Nothing more is needed from you. Our team will be in touch once they've reviewed your application.",
  };
}

/** "A", "A and B", "A, B and C" */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
