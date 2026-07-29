// FFSA Hub — Catalog of program (school) emails a leader can customize
// (migration 146). The single source of truth for which application
// emails are overridable, how they're labelled in the "Emails" tab, and
// which merge fields their copy supports.
//
// The acceptance / enrollment email is intentionally absent — it keeps
// its dedicated editor under the Application tab.

export type ProgramEmailType = {
  key: string;
  label: string;
  description: string;
  /** Who receives it — shown in the UI so leaders know the audience. */
  audience: "applicant" | "referee";
  /** Merge tokens the copy supports (rendered in the editor as hints). */
  mergeFields: string[];
};

// Applicant emails support {{first_name}} + {{program_name}}. Referee
// emails address the referee, so {{first_name}} isn't meaningful there.
const APPLICANT_FIELDS = ["{{first_name}}", "{{program_name}}"];
const REFEREE_FIELDS = ["{{program_name}}"];

export const PROGRAM_EMAIL_TYPES: ProgramEmailType[] = [
  {
    key: "application_received",
    label: "Application received",
    description:
      "Sent to the applicant the moment they submit — confirms you've got it, with a link to track their status.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
  },
  {
    key: "reference_request",
    label: "Reference request",
    description:
      "Sent to each referee the applicant lists, asking them to complete a reference.",
    audience: "referee",
    mergeFields: REFEREE_FIELDS,
  },
  {
    key: "reference_reminder",
    label: "Reference reminder",
    description:
      "A nudge to a referee who hasn't completed their reference yet (sent when you click remind).",
    audience: "referee",
    mergeFields: REFEREE_FIELDS,
  },
  {
    key: "application_rejected",
    label: "Application declined",
    description:
      "Sent to an applicant when you set their status to declined.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
  },
  {
    key: "application_waitlisted",
    label: "Waitlisted",
    description:
      "Sent to an applicant when you set their status to waitlisted.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
  },
  {
    key: "interview_scheduled",
    label: "Interview scheduled",
    description:
      "Sent to an applicant when you move them to interview scheduled.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
  },
];

export const PROGRAM_EMAIL_TYPE_KEYS = new Set(
  PROGRAM_EMAIL_TYPES.map((t) => t.key)
);

export function isProgramEmailType(key: string): boolean {
  return PROGRAM_EMAIL_TYPE_KEYS.has(key);
}
