// Shape a testimony row for Hub UI. Storage paths stay on the server;
// callers pass already-signed read URLs.

export type TestimonyMediaRow = {
  id: string;
  kind: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
};

export type TestimonyRow = {
  id: string;
  author_user_id: string;
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  people_reached: number;
  decisions: number;
  outcome: string;
  consent_to_share: boolean;
  status: string;
  published_at: string | null;
  published_by: string | null;
  withheld_reason: string | null;
  created_at: string;
  updated_at: string;
  evangelism_media?: TestimonyMediaRow[] | null;
};

export function presentTestimony(
  row: TestimonyRow,
  options: {
    urls: Map<string, string | null>;
    publish: boolean;
    authorName: string | null;
    /** When the signed read URLs stop working. Same value for every file in this response. */
    mediaExpiresAt?: string | null;
  }
) {
  const media = [...(row.evangelism_media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    occurred_on: row.occurred_on,
    location_label: row.location_label,
    people_reached: row.people_reached,
    decisions: row.decisions,
    outcome: row.outcome,
    consent_to_share: row.consent_to_share,
    status: row.status,
    published_at: row.published_at,
    author_user_id: row.author_user_id,
    author_name: options.authorName,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(options.publish ? { withheld_reason: row.withheld_reason, published_by: row.published_by } : {}),
    media: media.map((item) => ({
      id: item.id,
      kind: item.kind,
      content_type: item.content_type,
      size_bytes: item.size_bytes,
      sort_order: item.sort_order,
      url: options.urls.get(item.storage_path) ?? null,
      expires_at: options.mediaExpiresAt ?? null,
    })),
  };
}

export function displayName(user: {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
} | null): string | null {
  if (!user) return null;
  const first = (user.preferred_name || user.first_name || "").trim();
  const last = (user.last_name || "").trim();
  const name = `${first} ${last}`.trim();
  return name || null;
}
