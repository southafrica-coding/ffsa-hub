// FFSA Hub — Per-program email template overrides (migration 146).
// Backs the "Emails" tab and the resolver used at send time.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ProgramEmailTemplateRow = {
  email_type: string;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  reminder_after_days: number | null;
  updated_at: string;
};

export async function listProgramEmailTemplates(
  client: Client,
  programId: string
) {
  return client
    .from("program_email_templates")
    .select(
      "email_type, enabled, subject, body, reminder_after_days, updated_at"
    )
    .eq("program_id", programId);
}

export async function upsertProgramEmailTemplate(
  admin: Client,
  input: {
    programId: string;
    emailType: string;
    enabled: boolean;
    subject: string | null;
    body: string | null;
    reminderAfterDays: number | null;
    updatedBy: string;
  }
) {
  return admin.from("program_email_templates").upsert(
    {
      program_id: input.programId,
      email_type: input.emailType,
      enabled: input.enabled,
      subject: input.subject,
      body: input.body,
      reminder_after_days: input.reminderAfterDays,
      updated_by: input.updatedBy,
    },
    { onConflict: "program_id,email_type" }
  );
}
