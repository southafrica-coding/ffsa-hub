import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizePhoneE164 } from "@/lib/phone";
import { addContactEmail, addContactPhone } from "@/services/contact-identifiers";
import { MISSIO_SLUG, type OrgAccess } from "@/lib/missio/access";
import { maskEmail, maskName, maskPhone } from "@/lib/missio/mask";
import { missioMatchToken, sha256Hex } from "@/lib/missio/match-token";
import type {
  ContactMatch,
  CreateMissioPersonResponse,
  MissioCampus,
  MissioPeopleResponse,
  MissioPerson,
  MissioStatus,
} from "@/lib/missio/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const CAMPUS = ["potch", "jhb"] as const;
const STATUS = ["visitor", "active", "inactive"] as const;

const NAME_COLUMNS = ["first_name", "last_name", "preferred_name"] as const;

const DIRECTORY = "org_people_directory";

const DIRECTORY_COLUMNS =
  "id, org_id, contact_id, campus, status, joined_at, current_stage, created_at, updated_at, first_name, last_name, preferred_name";

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const isoDate = z.string().refine(isRealDate, "Use a real date as YYYY-MM-DD.");

export const peopleQuerySchema = z.object({
  campus: z.enum(CAMPUS).optional(),
  status: z.enum(STATUS).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const personFields = {
  campus: z.enum(CAMPUS).optional(),
  status: z.enum(STATUS).optional(),
  joinedAt: isoDate.nullable().optional(),
};

const linkSchema = z
  .object({
    matchToken: z.string().trim().min(20).max(200),
    matchedBy: z.union([
      z.object({ email: z.string().trim().min(3).max(320) }).strict(),
      z.object({ phone: z.string().trim().min(3).max(40) }).strict(),
    ]),
    ...personFields,
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    ...personFields,
  })
  .strict()
  .refine((value) => Boolean(value.email) || Boolean(value.phone), {
    message: "An email or a phone number is required.",
  });

export const updateSchema = z
  .object({
    campus: z.enum(CAMPUS).optional(),
    status: z.enum(STATUS).optional(),
    joinedAt: isoDate.nullable().optional(),
    currentStage: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();

type PersonRow = {
  id: string;
  contact_id: string;
  campus: MissioCampus;
  status: MissioStatus;
  joined_at: string | null;
  current_stage: string | null;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
};

export function toMissioPerson(row: PersonRow): MissioPerson {
  const legal = [row.first_name, row.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const name = legal || (row.preferred_name ?? "").trim();
  return {
    id: row.id,
    contactId: row.contact_id,
    name,
    campus: row.campus,
    status: row.status,
    joinedAt: row.joined_at ?? null,
    currentStage: row.current_stage ?? null,
  };
}

function splitName(name: string): { first_name: string; last_name: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const space = trimmed.indexOf(" ");
  if (space === -1) return { first_name: trimmed, last_name: "" };
  return { first_name: trimmed.slice(0, space), last_name: trimmed.slice(space + 1).trim() };
}

export function classifyLookup(
  raw: string
): { kind: "email"; value: string } | { kind: "phone"; value: string } | { kind: "reject" } {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "reject" };
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    const domain = email?.split("@")[1] ?? "";
    if (!email || !domain.includes(".")) return { kind: "reject" };
    return { kind: "email", value: email };
  }
  const phone = normalizePhoneE164(trimmed);
  if (!phone) return { kind: "reject" };
  return { kind: "phone", value: phone };
}

function adminClient(): { client: Client } | { error: string } {
  try {
    return { client: createAdminClient() };
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return { error: "Something went wrong." };
  }
}

export async function listPeople(auth: OrgAccess, query: z.infer<typeof peopleQuerySchema>): Promise<
  | { ok: true; body: MissioPeopleResponse }
  | { ok: false; status: number; error: string }
> {
  let request = auth.supabase
    .from(DIRECTORY)
    .select(DIRECTORY_COLUMNS, { count: "exact" })
    .eq("org_id", auth.orgId);

  if (query.campus) request = request.eq("campus", query.campus);
  if (query.status) request = request.eq("status", query.status);

  const tokens = (query.q ?? "")
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[,()]/g, ""))
    .filter(Boolean);
  for (const token of tokens) {
    const term = `%${escapeIlike(token)}%`;
    request = request.or(NAME_COLUMNS.map((column) => `${column}.ilike.${term}`).join(","));
  }

  const { data, error, count } = await request
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (error) {
    console.error("[missio] people list failed", error.message ?? "query error");
    return { ok: false, status: 500, error: "Something went wrong." };
  }

  const rows = ((data ?? []) as PersonRow[]).map(toMissioPerson);
  return { ok: true, body: { rows, total: typeof count === "number" ? count : rows.length } };
}

const SEARCH_CAP = 5;

export async function searchContacts(
  auth: OrgAccess,
  q: string
): Promise<{ ok: true; matches: ContactMatch[] } | { ok: false; status: number; error: string }> {
  const lookup = classifyLookup(q);
  if (lookup.kind === "reject") {
    return { ok: false, status: 400, error: "Search by an email address or a phone number." };
  }

  const admin = adminClient();
  if ("error" in admin) return { ok: false, status: 500, error: admin.error };

  const identifier = lookup.kind === "email"
    ? await admin.client
        .from("contact_emails")
        .select("contact_id")
        .eq("email_normalized", lookup.value)
        .limit(SEARCH_CAP)
    : await admin.client
        .from("contact_phones")
        .select("contact_id")
        .eq("phone_normalized", lookup.value)
        .limit(SEARCH_CAP);

  if (identifier.error) {
    console.error("[missio] contact search failed", identifier.error.message ?? "query error");
    return { ok: false, status: 500, error: "Something went wrong." };
  }

  const ids = [
    ...new Set(
      ((identifier.data ?? []) as Array<{ contact_id?: string }>)
        .map((row) => row.contact_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ].slice(0, SEARCH_CAP);
  if (ids.length === 0) return { ok: true, matches: [] };

  const [contacts, membership] = await Promise.all([
    admin.client.from("contacts").select("id, first_name, last_name, email, phone").in("id", ids),
    auth.supabase
      .from(DIRECTORY)
      .select("id, contact_id, first_name, last_name, preferred_name")
      .eq("org_id", auth.orgId)
      .in("contact_id", ids),
  ]);
  if (contacts.error || membership.error) {
    console.error(
      "[missio] contact search failed",
      contacts.error?.message ?? membership.error?.message ?? "query error"
    );
    return { ok: false, status: 500, error: "Something went wrong." };
  }

  const inOrg = new Map<string, { id: string; name: string }>();
  for (const row of (membership.data ?? []) as Array<{
    id?: string;
    contact_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    preferred_name?: string | null;
  }>) {
    if (!row.contact_id || !row.id) continue;
    const legal = [row.first_name, row.last_name]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    inOrg.set(row.contact_id, { id: row.id, name: legal || (row.preferred_name ?? "").trim() });
  }

  const matches: ContactMatch[] = ((contacts.data ?? []) as Array<{
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  }>)
    .map((contact) => {
      const member = inOrg.get(contact.id);
      const match: ContactMatch = {
        matchToken: missioMatchToken(auth.user.id, contact.id, lookup.value),
        maskedName: maskName(contact.first_name, contact.last_name),
        maskedEmail: maskEmail(contact.email),
        maskedPhone: maskPhone(contact.phone),
        alreadyInOrg: Boolean(member),
      };
      if (member) {
        match.personId = member.id;
        match.name = member.name;
      }
      return match;
    })
    .sort((a, b) => a.maskedName.localeCompare(b.maskedName) || a.matchToken.localeCompare(b.matchToken))
    .slice(0, SEARCH_CAP);

  await logSearchAudit(admin.client, auth.user.id, lookup.value, matches.length);
  return { ok: true, matches };
}

/**
 * One audit row per completed search. The query is stored only as a sha256
 * of the normalised value. audit_logs is the existing staff audit table.
 */
async function logSearchAudit(admin: Client, userId: string, normalizedQuery: string, resultCount: number) {
  const { error } = await admin.from("audit_logs").insert({
    user_id: userId,
    action: "missio.contact_search",
    resource_type: "missio_contact_search",
    resource_id: userId,
    changes: { querySha256: sha256Hex(normalizedQuery), resultCount },
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[missio] search audit failed", error.message ?? "insert failed");
}

async function contactIdsFor(
  admin: Client,
  table: "contact_emails" | "contact_phones",
  column: "email_normalized" | "phone_normalized",
  value: string
): Promise<{ ids: string[] } | { error: string }> {
  const { data, error } = await admin.from(table).select("contact_id").eq(column, value).limit(50);
  if (error) {
    console.error("[missio] identifier match failed", error.message);
    return { error: "Something went wrong." };
  }
  const ids = [
    ...new Set(
      ((data ?? []) as Array<{ contact_id?: string }>)
        .map((row) => row.contact_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  return { ids };
}

async function resolveMatchToken(
  admin: Client,
  userId: string,
  token: string,
  matchedBy: { email: string } | { phone: string }
): Promise<{ contactId: string } | { error: string; status: number }> {
  const normalized = "email" in matchedBy ? normalizeEmail(matchedBy.email) : normalizePhoneE164(matchedBy.phone);
  if (!normalized) return { error: "Check the fields and try again.", status: 400 };
  const found =
    "email" in matchedBy
      ? await contactIdsFor(admin, "contact_emails", "email_normalized", normalized)
      : await contactIdsFor(admin, "contact_phones", "phone_normalized", normalized);
  if ("error" in found) return { error: found.error, status: 500 };
  const contactId = found.ids.find((id) => missioMatchToken(userId, id, normalized) === token);
  if (!contactId) return { error: "Check the fields and try again.", status: 400 };
  return { contactId };
}

async function findExistingContact(
  admin: Client,
  email: string | null,
  phone: string | null
): Promise<{ contactId: string | null } | { conflict: true } | { error: string }> {
  const emailIds = email ? await contactIdsFor(admin, "contact_emails", "email_normalized", email) : { ids: [] as string[] };
  if ("error" in emailIds) return emailIds;
  const phoneIds = phone ? await contactIdsFor(admin, "contact_phones", "phone_normalized", phone) : { ids: [] as string[] };
  if ("error" in phoneIds) return phoneIds;

  if (email && phone && emailIds.ids.length > 0 && phoneIds.ids.length > 0) {
    const overlap = emailIds.ids.filter((id) => phoneIds.ids.includes(id));
    if (overlap.length === 1) return { contactId: overlap[0]! };
    return { conflict: true };
  }
  if (emailIds.ids[0]) return { contactId: emailIds.ids[0] };
  if (phoneIds.ids[0]) return { contactId: phoneIds.ids[0] };
  return { contactId: null };
}

async function addIdentifiers(
  admin: Client,
  args: { contactId: string; email: string | null; phone: string | null; source: string }
): Promise<string | null> {
  if (args.email) {
    const emailRow = await addContactEmail(admin, {
      contactId: args.contactId,
      email: args.email,
      makePrimary: true,
      source: args.source,
    });
    if (emailRow.error) {
      console.error("[missio] contact email insert failed", (emailRow.error as { message?: string }).message);
      return "email";
    }
  }
  if (args.phone) {
    const phoneRow = await addContactPhone(admin, {
      contactId: args.contactId,
      phone: args.phone,
      makePrimary: true,
      source: args.source,
    });
    if (phoneRow.error) {
      console.error("[missio] contact phone insert failed", (phoneRow.error as { message?: string }).message);
      return "phone";
    }
  }
  return null;
}

async function removeOrphanContact(admin: Client, contactId: string) {
  const removed = await admin.from("contacts").delete().eq("id", contactId);
  if (removed.error) console.error("[missio] orphan contact cleanup failed", removed.error.message);
}

async function loadPerson(
  supabase: Client,
  orgId: string,
  personId: string
): Promise<{ person: MissioPerson } | { error: string; status: number }> {
  const { data, error } = await supabase
    .from(DIRECTORY)
    .select(DIRECTORY_COLUMNS)
    .eq("id", personId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[missio] person read failed", error.message);
    return { error: "Something went wrong.", status: 500 };
  }
  if (!data) return { error: "Person not found.", status: 404 };
  return { person: toMissioPerson(data as PersonRow) };
}

async function missioOrgId(admin: Client): Promise<{ orgId: string } | { error: string }> {
  const org = await admin.from("organisations").select("id").eq("slug", MISSIO_SLUG).maybeSingle();
  if (org.error || !org.data?.id) {
    console.error("[missio] organisation lookup failed", org.error?.message ?? MISSIO_SLUG);
    return { error: "Something went wrong." };
  }
  return { orgId: org.data.id as string };
}

/**
 * Insert org_people with the service role. Authenticated has no INSERT grant
 * (migration 329). contactId must already be the verified match or the
 * contact row just created. org_id is the organisations row for slug missio.
 * The duplicate read and the row returned to the caller use the user client.
 * Campus, status, and stage are written only on this row, never onto contacts.
 */
async function linkPerson(
  auth: OrgAccess,
  admin: Client,
  input: {
    contactId: string;
    campus?: MissioCampus;
    status?: MissioStatus;
    joinedAt?: string | null;
  }
): Promise<{ ok: true; body: CreateMissioPersonResponse } | { ok: false; status: number; error: string }> {
  const org = await missioOrgId(admin);
  if ("error" in org) return { ok: false, status: 500, error: org.error };

  const existing = await auth.supabase
    .from("org_people")
    .select("id")
    .eq("org_id", org.orgId)
    .eq("contact_id", input.contactId)
    .maybeSingle();
  if (existing.error) {
    console.error("[missio] duplicate check failed", existing.error.message);
    return { ok: false, status: 500, error: "Something went wrong." };
  }
  if (existing.data) return { ok: false, status: 409, error: "This person is already in Missio." };

  const inserted = await admin
    .from("org_people")
    .insert({
      org_id: org.orgId,
      contact_id: input.contactId,
      campus: input.campus ?? "potch",
      status: input.status ?? "active",
      joined_at: input.joinedAt ?? null,
      created_by: auth.user.id,
    })
    .select("id")
    .single();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      return { ok: false, status: 409, error: "This person is already in Missio." };
    }
    console.error("[missio] org_people insert failed", inserted.error.message);
    return { ok: false, status: 500, error: "Something went wrong." };
  }

  const loaded = await loadPerson(auth.supabase, org.orgId, inserted.data.id as string);
  if ("error" in loaded) return { ok: false, status: loaded.status, error: loaded.error };
  return { ok: true, body: { person: loaded.person, linkedExisting: true } };
}

export async function createPerson(
  auth: OrgAccess,
  body: unknown
): Promise<{ ok: true; body: CreateMissioPersonResponse } | { ok: false; status: number; error: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Check the fields and try again." };
  }

  // The service-role client is opened only after requireOrgRole has already
  // returned. A failed role check never reaches this function.
  if ("matchToken" in body) {
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 400, error: "Check the fields and try again." };
    const admin = adminClient();
    if ("error" in admin) return { ok: false, status: 500, error: admin.error };
    const verified = await resolveMatchToken(admin.client, auth.user.id, parsed.data.matchToken, parsed.data.matchedBy);
    if ("error" in verified) return { ok: false, status: verified.status, error: verified.error };
    return linkPerson(auth, admin.client, {
      contactId: verified.contactId,
      campus: parsed.data.campus,
      status: parsed.data.status,
      joinedAt: parsed.data.joinedAt,
    });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: "Check the fields and try again." };

  const email = parsed.data.email ? normalizeEmail(parsed.data.email) : null;
  const phone = parsed.data.phone ? normalizePhoneE164(parsed.data.phone) : null;
  if (parsed.data.email && !email) return { ok: false, status: 400, error: "That email address isn't valid." };
  if (parsed.data.phone && !phone) return { ok: false, status: 400, error: "That phone number isn't valid." };
  if (!email && !phone) return { ok: false, status: 400, error: "An email or a phone number is required." };

  const admin = adminClient();
  if ("error" in admin) return { ok: false, status: 500, error: admin.error };

  const found = await findExistingContact(admin.client, email, phone);
  if ("error" in found) return { ok: false, status: 500, error: found.error };
  if ("conflict" in found) {
    return { ok: false, status: 409, error: "That email and phone belong to different people." };
  }
  if (found.contactId) {
    return linkPerson(auth, admin.client, {
      contactId: found.contactId,
      campus: parsed.data.campus,
      status: parsed.data.status,
      joinedAt: parsed.data.joinedAt,
    });
  }

  const { first_name, last_name } = splitName(parsed.data.name);
  const source = `missio:${auth.user.id}`;
  const emailTrimmed = parsed.data.email?.trim() ?? null;
  const created = await admin.client
    .from("contacts")
    .insert({
      first_name,
      last_name,
      email: email ? emailTrimmed : null,
      phone: parsed.data.phone?.trim() ?? null,
      phone_normalized: phone,
      source,
      // contacts.marketing_status defaults to 'subscribed'. A Missio add has
      // not confirmed marketing, so it starts pending.
      marketing_status: "pending",
    })
    .select("id")
    .single();
  if (created.error || !created.data?.id) {
    console.error("[missio] contact insert failed", created.error?.message ?? "no row");
    return { ok: false, status: 500, error: "Something went wrong." };
  }
  const contactId = created.data.id as string;

  // The org label is added by the org_people trigger (added_via = org_people_sync).
  // These routes never write contact_labels.
  //
  // TODO: contact_emails is unique on (contact_id, email_normalized) only, not
  // on the address itself (migration 068). A second request that creates the
  // same email at the same time does not hit a unique violation, so we cannot
  // re-match and link from error 23505. The duplicate check above is the guard.
  const identifierError = await addIdentifiers(admin.client, {
    contactId,
    email: email && parsed.data.email ? parsed.data.email : null,
    phone: phone && parsed.data.phone ? parsed.data.phone : null,
    source,
  });
  if (identifierError) {
    await removeOrphanContact(admin.client, contactId);
    return { ok: false, status: 500, error: "Something went wrong." };
  }

  const linked = await linkPerson(auth, admin.client, {
    contactId,
    campus: parsed.data.campus,
    status: parsed.data.status,
    joinedAt: parsed.data.joinedAt,
  });
  if (!linked.ok) return linked;
  return { ok: true, body: { person: linked.body.person, linkedExisting: false } };
}

export async function updatePerson(
  auth: OrgAccess,
  personId: string,
  body: unknown
): Promise<{ ok: true; person: MissioPerson } | { ok: false; status: number; error: string }> {
  // Pastors update campus, status, joined_at, and current_stage only.
  // contact_id and org_id would move the person onto another contact or org.
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if ("contact_id" in body || "org_id" in body) {
      return { ok: false, status: 400, error: "Check the fields and try again." };
    }
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: "Check the fields and try again." };

  const patch: Record<string, unknown> = {};
  if (parsed.data.campus !== undefined) patch.campus = parsed.data.campus;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.joinedAt !== undefined) patch.joined_at = parsed.data.joinedAt;
  if (parsed.data.currentStage !== undefined) patch.current_stage = parsed.data.currentStage;
  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, error: "Nothing to update." };
  }

  const updated = await auth.supabase
    .from("org_people")
    .update(patch)
    .eq("id", personId)
    .eq("org_id", auth.orgId)
    .select("id")
    .maybeSingle();
  if (updated.error) {
    console.error("[missio] person update failed", updated.error.message);
    return { ok: false, status: 500, error: "Something went wrong." };
  }
  if (!updated.data) return { ok: false, status: 404, error: "Person not found." };
  const loaded = await loadPerson(auth.supabase, auth.orgId, personId);
  if ("error" in loaded) return { ok: false, status: loaded.status, error: loaded.error };
  return { ok: true, person: loaded.person };
}

export function readPeopleQuery(url: URL) {
  const input: Record<string, string> = {};
  for (const key of ["campus", "status", "q", "limit", "offset"] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== "") input[key] = value;
  }
  return peopleQuerySchema.safeParse(input);
}
