import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgAccess } from "@/lib/missio/access";
import type { MissioErrorCode } from "@/lib/missio/types";

/**
 * Missio households (board M14a). Migration 341.
 *
 * Adults are contacts; children keep a first name, an optional surname and
 * a birth year, and never get messages. One adult is the main contact and
 * gets family messages ("Hi Esther & Johan"). Pastors manage households
 * (RLS 341); names come from contacts with the service role after that.
 */

export type HouseholdAdult = {
  memberId: string;
  contactId: string;
  /** The Missio people row, when they have one. */
  personId: string | null;
  name: string;
  firstName: string;
  label: string | null;
  main: boolean;
  houses: Array<{ id: string; number: number; name: string | null }>;
};

export type HouseholdChild = {
  memberId: string;
  firstName: string;
  lastName: string | null;
  birthYear: number;
};

export type Household = {
  id: string;
  /** "The Naidoos", or the name a pastor gave it. */
  title: string;
  name: string | null;
  mainContactId: string | null;
  adults: HouseholdAdult[];
  children: HouseholdChild[];
  /** "Hi Esther & Johan": how a family message opens. */
  greeting: string;
};

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };
const fail = (status: number, code: MissioErrorCode, error: string): Fail => ({ ok: false, status, code, error });
const broken = () => fail(500, "server_error", "Something went wrong.");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type MemberRow = {
  id: string;
  household_id: string;
  kind: "adult" | "child";
  contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_year: number | null;
  label: string | null;
  created_at: string;
};
type HouseholdRow = { id: string; name: string | null; main_contact_id: string | null; created_at: string };
type ContactRow = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };

const MEMBER_COLUMNS = "id, household_id, kind, contact_id, first_name, last_name, birth_year, label, created_at";

function admin(): Db | null {
  try {
    return createAdminClient();
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return null;
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** "The Naidoos", "The Botha family". A lone adult is just their name. */
export function householdTitle(name: string | null, adults: Array<{ name: string }>, children: Array<{ lastName: string | null }>): string {
  if (name?.trim()) return name.trim();
  const surnames = adults.map((adult) => adult.name.trim().split(/\s+/).slice(1).join(" ")).filter(Boolean);
  if (adults.length === 1 && children.length === 0) return adults[0]!.name;
  const surname = surnames[0] ?? children.find((child) => child.lastName)?.lastName ?? "";
  if (!surname) return adults.length > 0 ? joinNames(adults.map((adult) => adult.name.split(" ")[0]!)) : "Household";
  if (surnames.some((other) => other !== surname)) return joinNames(adults.map((adult) => adult.name));
  return /[sxzha]$/i.test(surname) || surname.includes(" ") ? `The ${surname} family` : `The ${surname}s`;
}

function nameOf(row: ContactRow | undefined): { name: string; first: string } {
  const first = (row?.preferred_name || row?.first_name || "").trim();
  return { name: [first, row?.last_name?.trim()].filter(Boolean).join(" "), first };
}

async function shape(auth: OrgAccess, households: HouseholdRow[], members: MemberRow[]): Promise<Household[] | Fail> {
  const contactIds = [...new Set(members.map((row) => row.contact_id).filter((id): id is string => Boolean(id)))];
  const contacts = new Map<string, ContactRow>();
  const people = new Map<string, string>();
  const houses = new Map<string, HouseholdAdult["houses"]>();
  if (contactIds.length > 0) {
    const db = admin();
    if (!db) return broken();
    const [contactRows, personRows, memberRows] = await Promise.all([
      db.from("contacts").select("id, first_name, last_name, preferred_name").in("id", contactIds),
      db.from("org_people").select("id, contact_id").eq("org_id", auth.orgId).in("contact_id", contactIds),
      db.from("house_church_members").select("contact_id, house_church_id").in("contact_id", contactIds).is("ended_at", null),
    ]);
    if (contactRows.error || personRows.error || memberRows.error) return broken();
    for (const row of (contactRows.data ?? []) as ContactRow[]) contacts.set(row.id, row);
    for (const row of (personRows.data ?? []) as Array<{ id: string; contact_id: string }>) people.set(row.contact_id, row.id);
    const membership = (memberRows.data ?? []) as Array<{ contact_id: string; house_church_id: string }>;
    if (membership.length > 0) {
      const houseRows = await db
        .from("house_churches")
        .select("id, number, name")
        .eq("org_id", auth.orgId)
        .in("id", [...new Set(membership.map((row) => row.house_church_id))]);
      if (houseRows.error) return broken();
      const byId = new Map(((houseRows.data ?? []) as Array<{ id: string; number: number; name: string | null }>).map((row) => [row.id, row]));
      for (const row of membership) {
        const house = byId.get(row.house_church_id);
        if (!house) continue;
        houses.set(row.contact_id, [...(houses.get(row.contact_id) ?? []), { id: house.id, number: house.number, name: house.name }]);
      }
    }
  }
  return households.map((household) => {
    const rows = members.filter((row) => row.household_id === household.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const adults: HouseholdAdult[] = rows
      .filter((row) => row.kind === "adult" && row.contact_id)
      .map((row) => {
        const { name, first } = nameOf(contacts.get(row.contact_id!));
        return {
          memberId: row.id,
          contactId: row.contact_id!,
          personId: people.get(row.contact_id!) ?? null,
          name: name || "Someone",
          firstName: first || "Someone",
          label: row.label ?? null,
          main: row.contact_id === household.main_contact_id,
          houses: houses.get(row.contact_id!) ?? [],
        };
      })
      .sort((a, b) => Number(b.main) - Number(a.main));
    const children: HouseholdChild[] = rows
      .filter((row) => row.kind === "child")
      .map((row) => ({ memberId: row.id, firstName: row.first_name ?? "", lastName: row.last_name, birthYear: Number(row.birth_year) }))
      .sort((a, b) => a.birthYear - b.birthYear);
    return {
      id: household.id,
      name: household.name,
      title: householdTitle(household.name, adults, children),
      mainContactId: household.main_contact_id,
      adults,
      children,
      greeting: `Hi ${joinNames(adults.map((adult) => adult.firstName))}`,
    };
  });
}

async function readHouseholds(auth: OrgAccess, ids: string[]): Promise<Household[] | Fail> {
  if (ids.length === 0) return [];
  const [households, members] = await Promise.all([
    auth.supabase.from("missio_households").select("id, name, main_contact_id, created_at").eq("org_id", auth.orgId).in("id", ids),
    auth.supabase.from("missio_household_members").select(MEMBER_COLUMNS).in("household_id", ids),
  ]);
  if (households.error || members.error) {
    console.error("[missio] household read failed", (households.error ?? members.error)?.message);
    return broken();
  }
  return shape(auth, (households.data ?? []) as HouseholdRow[], (members.data ?? []) as MemberRow[]);
}

async function one(auth: OrgAccess, id: string): Promise<{ ok: true; household: Household } | Fail> {
  const read = await readHouseholds(auth, [id]);
  if (!Array.isArray(read)) return read;
  if (!read[0]) return fail(404, "not_found", "Household not found.");
  return { ok: true, household: read[0] };
}

async function contactOfPerson(auth: OrgAccess, personId: string): Promise<string | Fail> {
  const row = await auth.supabase.from("org_people").select("contact_id").eq("id", personId).eq("org_id", auth.orgId).maybeSingle();
  if (row.error) return broken();
  const contactId = (row.data as { contact_id?: string } | null)?.contact_id;
  return contactId ?? fail(404, "not_found", "Person not found.");
}

async function householdOfContact(auth: OrgAccess, contactId: string): Promise<string | null | Fail> {
  const row = await auth.supabase.from("missio_household_members").select("household_id").eq("contact_id", contactId).maybeSingle();
  if (row.error) return broken();
  return (row.data as { household_id?: string } | null)?.household_id ?? null;
}

async function audit(auth: OrgAccess, action: string, id: string, changes: Record<string, unknown>) {
  const db = admin();
  if (!db) return;
  const logged = await db.from("audit_logs").insert({
    user_id: auth.user.id,
    action,
    resource_type: "missio_household",
    resource_id: id,
    changes,
    created_at: new Date().toISOString(),
  });
  if (logged.error) console.error("[missio] audit failed", logged.error.message);
}

/** The household a Missio person belongs to, or null. */
export async function householdForPerson(auth: OrgAccess, personId: string): Promise<{ ok: true; household: Household | null } | Fail> {
  const contactId = await contactOfPerson(auth, personId);
  if (typeof contactId !== "string") return contactId;
  const id = await householdOfContact(auth, contactId);
  if (id !== null && typeof id !== "string") return id;
  if (!id) return { ok: true, household: null };
  return one(auth, id);
}

/** Start a household with this person as its first adult and main contact. */
export async function createHousehold(auth: OrgAccess, body: unknown): Promise<{ ok: true; household: Household } | Fail> {
  const parsed = z.object({ personId: z.string().uuid() }).strict().safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const contactId = await contactOfPerson(auth, parsed.data.personId);
  if (typeof contactId !== "string") return contactId;
  const existing = await householdOfContact(auth, contactId);
  if (existing !== null && typeof existing !== "string") return existing;
  if (existing) return one(auth, existing);
  const id = crypto.randomUUID();
  const made = await auth.supabase
    .from("missio_households")
    .insert({ id, org_id: auth.orgId, main_contact_id: contactId, created_by: auth.user.id });
  if (made.error) return broken();
  const member = await auth.supabase.from("missio_household_members").insert({ household_id: id, kind: "adult", contact_id: contactId });
  if (member.error) {
    await auth.supabase.from("missio_households").delete().eq("id", id);
    return member.error.code === "23505" ? fail(409, "in_other_household", "They’re already in a household.") : broken();
  }
  await audit(auth, "missio.household_created", id, { contactId });
  return one(auth, id);
}

const addSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("adult"), personId: z.string().uuid(), label: z.string().trim().min(1).max(30).optional() }).strict(),
  z
    .object({
      kind: z.literal("child"),
      firstName: z.string().trim().min(1).max(60),
      lastName: z.string().trim().min(1).max(60).optional(),
      birthYear: z.number().int().min(1990).max(2100),
    })
    .strict(),
]);

/** Add an adult (a Missio person) or a child. */
export async function addHouseholdMember(auth: OrgAccess, householdId: string, body: unknown, now = new Date()) {
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const found = await one(auth, householdId);
  if (!found.ok) return found;
  const input = parsed.data;
  if (input.kind === "child") {
    if (input.birthYear > now.getUTCFullYear()) return fail(400, "invalid_input", "Check the year born.");
    const added = await auth.supabase.from("missio_household_members").insert({
      household_id: householdId,
      kind: "child",
      first_name: input.firstName,
      last_name: input.lastName ?? null,
      birth_year: input.birthYear,
    });
    if (added.error) return broken();
    await audit(auth, "missio.household_child_added", householdId, {});
    return one(auth, householdId);
  }
  const contactId = await contactOfPerson(auth, input.personId);
  if (typeof contactId !== "string") return contactId;
  const elsewhere = await householdOfContact(auth, contactId);
  if (elsewhere !== null && typeof elsewhere !== "string") return elsewhere;
  if (elsewhere === householdId) return found;
  if (elsewhere) return fail(409, "in_other_household", "They’re already in another household.");
  const added = await auth.supabase
    .from("missio_household_members")
    .insert({ household_id: householdId, kind: "adult", contact_id: contactId, label: input.label ?? null });
  if (added.error) return added.error.code === "23505" ? fail(409, "in_other_household", "They’re already in another household.") : broken();
  if (!found.household.mainContactId) await auth.supabase.from("missio_households").update({ main_contact_id: contactId }).eq("id", householdId);
  await audit(auth, "missio.household_adult_added", householdId, { contactId });
  return one(auth, householdId);
}

const editSchema = z
  .object({
    name: z.string().trim().max(80).nullable().optional(),
    mainContactId: z.string().uuid().optional(),
  })
  .strict();

/** Rename, or choose the main contact (an adult in the household). */
export async function updateHousehold(auth: OrgAccess, householdId: string, body: unknown) {
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const found = await one(auth, householdId);
  if (!found.ok) return found;
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name?.trim() ? parsed.data.name.trim() : null;
  if (parsed.data.mainContactId) {
    if (!found.household.adults.some((adult) => adult.contactId === parsed.data.mainContactId)) {
      return fail(400, "invalid_input", "The main contact must be an adult in the household.");
    }
    patch.main_contact_id = parsed.data.mainContactId;
  }
  if (Object.keys(patch).length === 0) return found;
  const saved = await auth.supabase.from("missio_households").update(patch).eq("id", householdId);
  if (saved.error) return broken();
  await audit(auth, "missio.household_updated", householdId, { fields: Object.keys(patch) });
  return one(auth, householdId);
}

/** Take someone out. The last adult leaving ends the household. */
export async function removeHouseholdMember(
  auth: OrgAccess,
  householdId: string,
  memberId: string
): Promise<{ ok: true; household: Household | null } | Fail> {
  const found = await one(auth, householdId);
  if (!found.ok) return found;
  const { household } = found;
  const adult = household.adults.find((row) => row.memberId === memberId);
  const child = household.children.find((row) => row.memberId === memberId);
  if (!adult && !child) return fail(404, "not_found", "Not in this household.");
  if (adult && household.adults.length === 1) {
    const ended = await auth.supabase.from("missio_households").delete().eq("id", householdId);
    if (ended.error) return broken();
    await audit(auth, "missio.household_ended", householdId, {});
    return { ok: true, household: null };
  }
  const removed = await auth.supabase.from("missio_household_members").delete().eq("id", memberId).eq("household_id", householdId);
  if (removed.error) return broken();
  if (adult?.main) {
    const next = household.adults.find((row) => row.memberId !== memberId);
    await auth.supabase.from("missio_households").update({ main_contact_id: next?.contactId ?? null }).eq("id", householdId);
  }
  await audit(auth, "missio.household_member_removed", householdId, { kind: adult ? "adult" : "child" });
  return one(auth, householdId);
}

/** Every household, for the People → Households view. */
export async function listHouseholds(auth: OrgAccess): Promise<{ ok: true; households: Household[] } | Fail> {
  const rows = await auth.supabase.from("missio_households").select("id").eq("org_id", auth.orgId).order("created_at", { ascending: false }).limit(500);
  if (rows.error) return broken();
  const read = await readHouseholds(auth, ((rows.data ?? []) as Array<{ id: string }>).map((row) => row.id));
  if (!Array.isArray(read)) return read;
  return { ok: true, households: read.sort((a, b) => a.title.localeCompare(b.title)) };
}
