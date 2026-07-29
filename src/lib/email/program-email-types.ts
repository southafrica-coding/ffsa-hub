// FFSA Hub — Catalog of program (school) emails a leader can customize
// (migration 146). The single source of truth for which application
// emails are overridable, how they're labelled in the "Emails" tab, the
// merge fields their copy supports, AND the built-in default subject +
// message. The editor pre-fills those defaults so a leader sees exactly
// what's sent today and edits from there; the send-time resolver uses the
// same defaults to render a customized email so it matches the original.
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
  /** Built-in default subject (template with merge tokens). */
  defaultSubject: string;
  /** Small uppercase label above the heading in the sent email. */
  defaultEyebrow: string;
  /** Heading of the sent email (template with merge tokens). */
  defaultHeading: string;
  /** Built-in default message body (plain text with merge tokens). */
  defaultBody: string;
  /**
   * When set, this email can auto-send on a delay via the reminders cron.
   * `trigger` describes what the delay is measured from (shown in the UI).
   */
  autoReminder?: { trigger: string };
};

// Applicant emails address the applicant by {{first_name}}. Referee
// emails address the referee and reference the applicant + slot; those
// tokens are filled automatically from the application.
const APPLICANT_FIELDS = ["{{first_name}}", "{{program_name}}"];
const REFEREE_FIELDS = [
  "{{program_name}}",
  "{{applicant_name}}",
  "{{referee_name}}",
  "{{reference_type}}",
];

export const PROGRAM_EMAIL_TYPES: ProgramEmailType[] = [
  {
    key: "application_received",
    label: "Application received",
    description:
      "Sent to the applicant the moment they submit — confirms you've got it, with a link to track their status.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
    defaultSubject: "Application Received — {{program_name}}",
    defaultEyebrow: "Application Received",
    defaultHeading: "Thank You, {{first_name}}",
    defaultBody:
      "Your application to {{program_name}} has been received and is now under review.\n\n" +
      "Our team will review your application and get back to you as soon as possible. You'll receive an email once a decision has been made.\n\n" +
      "If you have any questions in the meantime, feel free to reach out to us.",
  },
  {
    key: "reference_request",
    label: "Reference request",
    description:
      "Sent to each referee the applicant lists, asking them to complete a reference.",
    audience: "referee",
    mergeFields: REFEREE_FIELDS,
    defaultSubject: "Reference Request — {{program_name}}",
    defaultEyebrow: "Reference Request",
    defaultHeading: "Hi {{referee_name}}",
    defaultBody:
      "{{applicant_name}} has listed you as a {{reference_type}} for their application to {{program_name}}.\n\n" +
      "Please take a few minutes to submit your reference by clicking the button below.",
  },
  {
    key: "reference_reminder",
    label: "Reference reminder",
    description:
      "A nudge to a referee who hasn't completed their reference yet. Send it manually, or set it to go out automatically after a few days.",
    audience: "referee",
    mergeFields: REFEREE_FIELDS,
    defaultSubject: "Reference Reminder — {{program_name}}",
    defaultEyebrow: "Friendly Reminder",
    defaultHeading: "Hi {{referee_name}}",
    defaultBody:
      "Just a friendly reminder that {{applicant_name}} listed you as a {{reference_type}} for their application to {{program_name}}, and we haven't received your reference yet.\n\n" +
      "We would really appreciate it if you could take a few minutes to submit your reference when you get a chance. It makes a big difference in helping us process their application.",
    autoReminder: { trigger: "the reference was requested" },
  },
  {
    key: "application_rejected",
    label: "Application declined",
    description:
      "Sent to an applicant when you set their status to declined.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
    defaultSubject: "Application Update — {{program_name}}",
    defaultEyebrow: "Application Update",
    defaultHeading: "Application Decision",
    defaultBody:
      "Hi {{first_name}},\n\n" +
      "Thank you for your interest in {{program_name}} and for taking the time to apply. We truly appreciate the effort you put into your application.\n\n" +
      "After careful review, we are unfortunately unable to offer you a place in the program at this time. Please know that this was not an easy decision, and it does not diminish the value of your calling or gifts.\n\n" +
      "We wish you all the best for the future and encourage you to continue pursuing what God has placed on your heart. We would love to see you apply again in the future.",
  },
  {
    key: "application_waitlisted",
    label: "Waitlisted",
    description:
      "Sent to an applicant when you set their status to waitlisted.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
    defaultSubject: "Application Update — {{program_name}}",
    defaultEyebrow: "Application Update",
    defaultHeading: "You're on the Waitlist",
    defaultBody:
      "Hi {{first_name}},\n\n" +
      "Thank you for applying to {{program_name}}. Your application was strong, and we were impressed by what you shared.\n\n" +
      "At this stage, we have placed you on our waitlist. This means that if a spot opens up, we will reach out to you as soon as possible.\n\n" +
      "We appreciate your patience and will keep you updated on any changes. In the meantime, feel free to reach out if you have any questions.",
  },
  {
    key: "interview_scheduled",
    label: "Interview scheduled",
    description:
      "Sent to an applicant when you move them to interview scheduled.",
    audience: "applicant",
    mergeFields: APPLICANT_FIELDS,
    defaultSubject: "Interview Scheduled — {{program_name}}",
    defaultEyebrow: "Next Steps",
    defaultHeading: "Interview Scheduled",
    defaultBody:
      "Hi {{first_name}},\n\n" +
      "Congratulations on progressing to the interview stage of your application to {{program_name}}! We enjoyed reading your application and would love to get to know you better.\n\n" +
      "If you have any questions or need to reschedule, please don't hesitate to reach out. We look forward to speaking with you!",
  },
];

export const PROGRAM_EMAIL_TYPE_KEYS = new Set(
  PROGRAM_EMAIL_TYPES.map((t) => t.key)
);

export function isProgramEmailType(key: string): boolean {
  return PROGRAM_EMAIL_TYPE_KEYS.has(key);
}

export function getProgramEmailType(
  key: string
): ProgramEmailType | undefined {
  return PROGRAM_EMAIL_TYPES.find((t) => t.key === key);
}
