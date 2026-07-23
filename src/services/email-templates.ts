// Email templates — user-saved reusable email layouts (migration 133).
// The block layout is stored as jsonb in email_templates.body_source, the same
// shape as campaigns.body_source. Complements the code-defined starter presets
// in src/lib/campaigns/templates.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type EmailTemplateRow = {
  id: string;
  name: string;
  tagline: string | null;
  body_source: unknown;
  thumbnail_url: string | null;
  created_by: string | null;
  created_at: string;
};

export async function listEmailTemplates(supabase: Client) {
  return supabase
    .from("email_templates")
    .select("id, name, tagline, body_source, thumbnail_url, created_by, created_at")
    .order("created_at", { ascending: false });
}

export async function createEmailTemplate(
  supabase: Client,
  data: {
    name: string;
    tagline?: string | null;
    body_source: unknown;
    thumbnail_url?: string | null;
    created_by?: string | null;
  }
) {
  return supabase
    .from("email_templates")
    .insert({
      name: data.name,
      tagline: data.tagline ?? null,
      body_source: data.body_source,
      thumbnail_url: data.thumbnail_url ?? null,
      created_by: data.created_by ?? null,
    })
    .select("id, name, tagline, body_source, thumbnail_url, created_by, created_at")
    .single();
}

export async function deleteEmailTemplate(supabase: Client, id: string) {
  return supabase.from("email_templates").delete().eq("id", id);
}
