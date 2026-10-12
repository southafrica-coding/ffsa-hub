// Sending identity CRUD. Identities are the "From" addresses on outbound
// campaigns. They're referenced by campaigns via FK, so we never hard-delete
// — toggle is_active=false instead.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type SendingIdentity = {
  id: string;
  slug: string;
  display_name: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  /** Staff inboxes this team's replies are forwarded to (migration 228). */
  forward_to: string[];
  /** Work address Hub Inbox replies are sent From (migration 229). */
  reply_from_email: string | null;
  provider: "mailtrap" | "resend";
  is_active: boolean;
  created_at: string;
};

export type SendingIdentityInsert = {
  slug?: string;
  display_name: string;
  from_email: string;
  from_name: string;
  reply_to?: string | null;
  forward_to?: string[];
  reply_from_email?: string | null;
  provider?: "mailtrap" | "resend";
  is_active?: boolean;
};

export type SendingIdentityPatch = Partial<
  Pick<
    SendingIdentity,
    | "display_name"
    | "from_email"
    | "from_name"
    | "reply_to"
    | "forward_to"
    | "reply_from_email"
    | "is_active"
  >
>;

// ────────────────────────────────────────────────────────────
// Slug helpers
// ────────────────────────────────────────────────────────────

/** Slugify a display name: lowercase, alphanumeric + hyphens, trimmed. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "identity";
}

/** Find a unique slug, appending -2, -3, … if the base collides. */
export async function ensureUniqueSlug(
  supabase: Client,
  base: string,
  ignoreId?: string
): Promise<string> {
  const baseSlug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
    let q = supabase
      .from("sending_identities")
      .select("id")
      .eq("slug", candidate)
      .limit(1);
    if (ignoreId) q = q.neq("id", ignoreId);
    const { data } = await q;
    if (!data || data.length === 0) return candidate;
  }
  // Fallback — append a timestamp.
  return `${baseSlug}-${Date.now().toString(36)}`;
}

// ────────────────────────────────────────────────────────────
// Reply forwarding (migration 228)
// ────────────────────────────────────────────────────────────

/** Trim, lowercase, dedupe. */
export function normalizeForwardList(list: string[]): string[] {
  return Array.from(
    new Set(list.map((a) => a.trim().toLowerCase()).filter(Boolean))
  );
}

/**
 * Why a forward list is unusable, or null when it's fine. An ffsahub.com
 * address is refused: Resend receives that domain, so forwarding into it
 * would deliver the reply straight back to the Hub — a loop.
 */
export function forwardListError(list: string[]): string | null {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const a of normalizeForwardList(list)) {
    if (!re.test(a)) return `"${a}" isn't a valid email address`;
    if (a.endsWith("@ffsahub.com")) {
      return `Replies can't be forwarded to ${a} — ffsahub.com addresses are the Hub's own inboxes. Use the staff member's ffsouthafrica.com (or other) address.`;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────

export async function listAllSendingIdentities(supabase: Client) {
  return supabase
    .from("sending_identities")
    .select("*")
    .order("is_active", { ascending: false })
    .order("display_name");
}

export async function getSendingIdentity(supabase: Client, id: string) {
  return supabase
    .from("sending_identities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
}

export async function createSendingIdentity(
  supabase: Client,
  input: SendingIdentityInsert
) {
  const slug = await ensureUniqueSlug(supabase, input.slug || input.display_name);
  const row = {
    slug,
    display_name: input.display_name.trim(),
    from_email: input.from_email.trim().toLowerCase(),
    from_name: input.from_name.trim(),
    reply_to: input.reply_to?.trim() || null,
    forward_to: normalizeForwardList(input.forward_to ?? []),
    reply_from_email: input.reply_from_email?.trim().toLowerCase() || null,
    provider: input.provider ?? "resend",
    is_active: input.is_active ?? true,
  };
  return supabase.from("sending_identities").insert(row).select().single();
}

export async function updateSendingIdentity(
  supabase: Client,
  id: string,
  patch: SendingIdentityPatch
) {
  const normalized: Record<string, unknown> = {};
  if (patch.display_name !== undefined)
    normalized.display_name = patch.display_name.trim();
  if (patch.from_email !== undefined)
    normalized.from_email = patch.from_email.trim().toLowerCase();
  if (patch.from_name !== undefined)
    normalized.from_name = patch.from_name.trim();
  if (patch.reply_to !== undefined)
    normalized.reply_to = patch.reply_to?.trim() || null;
  if (patch.reply_from_email !== undefined)
    normalized.reply_from_email = patch.reply_from_email?.trim().toLowerCase() || null;
  if (patch.forward_to !== undefined)
    normalized.forward_to = normalizeForwardList(patch.forward_to);
  if (patch.is_active !== undefined) normalized.is_active = patch.is_active;
  return supabase
    .from("sending_identities")
    .update(normalized)
    .eq("id", id)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// Domain verification helper (UI-side hint only — Resend is the
// source of truth for which domains can actually send).
// ────────────────────────────────────────────────────────────

const VERIFIED_DOMAINS = new Set(["ffsahub.com"]);

export function isLikelyVerifiedDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return VERIFIED_DOMAINS.has(email.slice(at + 1).toLowerCase());
}
