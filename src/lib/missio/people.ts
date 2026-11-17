import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizePhoneE164 } from "@/lib/phone";
import { addContactEmail, addContactPhone } from "@/services/contact-identifiers";
import type { OrgAccess } from "@/lib/missio/access";
import { maskEmail, maskPhone } from "@/lib/missio/mask";
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

const PERSON_COLUMNS =
  "id, contact_id, campus, status, joined_at, current_stage, contacts(first_name, last_name)";

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
    contactId: z.string().uuid(),
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

type ContactEmbed = { first_name?: string | null; last_name?: string | null };

type PersonRow = {
  id: string;
  contact_id: string;
  campus: MissioCampus;
  status: MissioStatus;
  joined_at: string | null;
  current_stage: string | null;
  contacts?: ContactEmbed | ContactEmbed[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function toMissioPerson(row: PersonRow): MissioPerson {
  const contact = one(row.contacts);
  const name = [contact?.first_name, contact?.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
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
    .from("org_people")
    .select(PERSON_COLUMNS.replace("contacts(", "contacts!inner("), { count: "exact" })
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
    request = request.or(
      NAME_COLUMNS.map((column) => `${column}.ilike.${term}`).join(","),
      { referencedTable: "contacts" }
    );
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
    auth.supabase.from("org_people").select("contact_id").eq("org_id", auth.orgId).in("contact_id", ids),
  ]);
  if (contacts.error || membership.error) {
    console.error(
      "[missio] contact search failed",
      contacts.error?.message ?? membership.error?.message ?? "query error"
    );
    return { ok: false, status: 500, error: "Something went wrong." };
  }

  const inOrg = new Set(
    ((membership.data ?? []) as Array<{ contact_id?: string }>).map((row) => row.contact_id).filter(Boolean)
  );
  const matches: ContactMatch[] = ((contacts.data ?? []) as Array<{
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  }>)
    .map((contact) => ({
      contactId: contact.id,
      name: [contact.first_name, contact.last_name]
        .map((part) => (part ?? "").trim())
        .filter(Boolean)
        .join(" "),
      maskedEmail: maskEmail(contact.email),
      maskedPhone: maskPhone(contact.phone),
      alreadyInOrg: inOrg.has(contact.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contactId.localeCompare(b.contactId))
    .slice(0, SEARCH_CAP);

  return { ok: true, matches };
}

async function identifierMatches(
  admin: Client,
  contactId: string,
  matchedBy: { email: string } | { phone: string }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if ("email" in matchedBy) {
    const email = normalizeEmail(matchedBy.email);
    if (!email) return { ok: false, status: 400, error: "That contact does not have this email or phone." };
    const { data, error } = await admin
      .from("contact_emails")
      .select("contact_id")
      .eq("contact_id", contactId)
      .eq("email_normalized", email)
      .limit(1);
    if (error) {
      console.error("[missio] email check failed", error.message);
      return { ok: false, status: 500, error: "Something went wrong." };
    }
    if (!data || data.length === 0) {
      return { ok: false, status: 400, error: "That contact does not have this email or phone." };
    }
    return { ok: true };
  }

  const phone = normalizePhoneE164(matchedBy.phone);
  if (!phone) return { ok: false, status: 400, error: "That contact does not have this email or phone." };
  const { data, error } = await admin
    .from("contact_phones")
    .select("contact_id")
    .eq("contact_id", contactId)
    .eq("phone_normalized", phone)
    .limit(1);
  if (error) {
    console.error("[missio] phone check failed", error.message);
    return { ok: false, status: 500, error: "Something went wrong." };
  }
  if (!data || data.length === 0) {
    return { ok: false, status: 400, error: "That contact does not have this email or phone." };
  }
  return { ok: true };
}

async function findExistingContact(
  admin: Client,
  email: string | null,
  phone: string | null
): Promise<{ contactId: string | null } | { error: string }> {
  if (email) {
    const { data, error } = await admin
      .from("contact_emails")
      .select("contact_id")
      .eq("email_normalized", email)
      .limit(1);
    if (error) {
      console.error("[missio] email match failed", error.message);
      return { error: "Something went wrong." };
    }
    const contactId = (data?.[0] as { contact_id?: string } | undefined)?.contact_id;
    if (contactId) return { contactId };
  }
  if (phone) {
    const { data, error } = await admin
      .from("contact_phones")
      .select("contact_id")
      .eq("phone_normalized", phone)
      .limit(1);
    if (error) {
      console.error("[missio] phone match failed", error.message);
      return { error: "Something went wrong." };
    }
    const contactId = (data?.[0] as { contact_id?: string } | undefined)?.contact_id;
    if (contactId) return { contactId };
  }
  return { contactId: null };
}

async function loadPerson(
  supabase: Client,
  orgId: string,
  personId: string
): Promise<{ person: MissioPerson } | { error: string; status: number }> {
  const { data, error } = await supabase
    .from("org_people")
    .select(PERSON_COLUMNS)
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

/**
 * Insert org_people on the signed-in user's client. contactId must already
 * be the verified match or the contact row just created — never the raw
 * request id on its own. org_id is the Missio organisation from the org
 * check. Campus, status, and stage are written only here, never onto contacts.
 * created_by is the signed-in pastor, not a field from the body.
 */
async function linkPerson(
  auth: OrgAccess,
  input: {
    contactId: string;
    campus?: MissioCampus;
    status?: MissioStatus;
    joinedAt?: string | null;
  }
): Promise<{ ok: true; body: CreateMissioPersonResponse } | { ok: false; status: number; error: string }> {
  const existing = await auth.supabase
    .from("org_people")
    .select("id")
    .eq("org_id", auth.orgId)
    .eq("contact_id", input.contactId)
    .maybeSingle();
  if (existing.error) {
    console.error("[missio] duplicate check failed", existing.error.message);
    return { ok: false, status: 500, error: "Something went wrong." };
  }
  if (existing.data) return { ok: false, status: 409, error: "This person is already in Missio." };

  const inserted = await auth.supabase
    .from("org_people")
    .insert({
      org_id: auth.orgId,
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

  const loaded = await loadPerson(auth.supabase, auth.orgId, inserted.data.id as string);
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
  if ("contactId" in body) {
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 400, error: "Check the fields and try again." };
    const admin = adminClient();
    if ("error" in admin) return { ok: false, status: 500, error: admin.error };
    const verified = await identifierMatches(admin.client, parsed.data.contactId, parsed.data.matchedBy);
    // No org_people insert unless this contact really has that email or phone.
    if (!verified.ok) return verified;
    const linked = await linkPerson(auth, {
      contactId: parsed.data.contactId,
      campus: parsed.data.campus,
      status: parsed.data.status,
      joinedAt: parsed.data.joinedAt,
    });
    if (!linked.ok) return linked;
    return { ok: true, body: { person: linked.body.person, linkedExisting: false } };
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
  if (found.contactId) {
    return linkPerson(auth, {
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
  if (email && parsed.data.email) {
    const emailRow = await addContactEmail(admin.client, {
      contactId,
      email: parsed.data.email,
      makePrimary: true,
      source,
    });
    if (emailRow.error) {
      console.error("[missio] contact email insert failed", (emailRow.error as { message?: string }).message);
      return { ok: false, status: 500, error: "Something went wrong." };
    }
  }
  if (phone && parsed.data.phone) {
    const phoneRow = await addContactPhone(admin.client, {
      contactId,
      phone: parsed.data.phone,
      makePrimary: true,
      source,
    });
    if (phoneRow.error) {
      console.error("[missio] contact phone insert failed", (phoneRow.error as { message?: string }).message);
      return { ok: false, status: 500, error: "Something went wrong." };
    }
  }

  const linked = await linkPerson(auth, {
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
    .select(PERSON_COLUMNS)
    .maybeSingle();
  if (updated.error) {
    console.error("[missio] person update failed", updated.error.message);
    return { ok: false, status: 500, error: "Something went wrong." };
  }
  if (!updated.data) return { ok: false, status: 404, error: "Person not found." };
  return { ok: true, person: toMissioPerson(updated.data as PersonRow) };
}

export function readPeopleQuery(url: URL) {
  const input: Record<string, string> = {};
  for (const key of ["campus", "status", "q", "limit", "offset"] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== "") input[key] = value;
  }
  return peopleQuerySchema.safeParse(input);
}
