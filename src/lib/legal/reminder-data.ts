// Loads what buildReminder needs. Works with either client:
//   * the user's client — preview and dashboard card; RLS limits it to
//     what that person may see;
//   * the service role — the 07:00 cron only, which emails the owner.

import { buildReminder, type Reminder, type ReminderApp, type ReminderDoc } from "./reminders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function loadReminder(supabase: Client, today: string): Promise<Reminder> {
  const [docs, apps, types, folders] = await Promise.all([
    supabase
      .from("legal_documents")
      .select("id, title, folder_id, type_id, expires_on, renew_lead_days, status, superseded_by"),
    supabase
      .from("legal_applications")
      .select("id, title, folder_id, document_id, status, lodge_by, submitted_on, expected_on"),
    supabase.from("legal_document_types").select("id, lead_days"),
    supabase.from("legal_folders").select("id, name, archived_at"),
  ]);
  const failed = [docs, apps, types, folders].find((r) => r.error);
  if (failed) throw new Error(`Could not load legal documents: ${failed.error.message}`);

  // Papers in an archived folder are put away on purpose: no reminders.
  const archived = new Set(
    (folders.data as Array<{ id: string; archived_at: string | null }>).filter((f) => f.archived_at).map((f) => f.id)
  );
  return buildReminder({
    today,
    documents: (docs.data as ReminderDoc[]).filter((d) => !archived.has(d.folder_id)),
    applications: (apps.data as ReminderApp[]).filter((a) => !archived.has(a.folder_id)),
    typeLeadDays: new Map((types.data as Array<{ id: string; lead_days: number }>).map((t) => [t.id, t.lead_days])),
    folderNames: new Map((folders.data as Array<{ id: string; name: string }>).map((f) => [f.id, f.name])),
  });
}
