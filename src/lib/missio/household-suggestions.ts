import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgAccess } from "@/lib/missio/access";
import {
  addHouseholdMember,
  createHousehold,
  householdForContact,
  removeHouseholdMember,
  type Household,
} from "@/lib/missio/households";
import type { MissioErrorCode } from "@/lib/missio/types";

/**
 * Couple suggestions for a pastor to confirm (migration 398, not applied).
 *
 * The gated script files pending pairs from the house church sheet. Here a
 * pastor reads them (RLS: Missio pastors) and either links the pair as a
 * household or says they're not a couple. Linking goes through the
 * household helpers in ./households — never a second family graph:
 *
 *   neither has a household   create one with A, add B
 *   one has a household       only with addToExisting (a second, explicit
 *                             click): add the other adult to it
 *   both in the same one      nothing to do; mark accepted
 *   both in different ones    refuse; a pastor sorts that out by hand
 *
 * Nothing is deleted from an existing household and no children are added.
 * Payloads carry first names and person ids only: no emails or phones.
 * Until 398 is applied the table is missing and the list is empty.
 */

export type SuggestionPerson = {
  personId: string;
  firstName: string;
};

export type HouseholdSuggestion = {
  id: string;
  a: SuggestionPerson;
  b: SuggestionPerson;
  /** The house they share now, when they share one. */
  houseNumber: number | null;
  /**
   * What Link would do: new (start a household), join (one of them already
   * has one), same (already together), separate (each has their own).
   */
  link: "new" | "join" | "same" | "separate";
};

export type ReviewResult =
  | { ok: true; status: "accepted" | "dismissed"; household: Household | null }
  | Fail;

type Fail = {
  ok: false;
  status: number;
  error: string;
  code: MissioErrorCode;
  /** household_exists: the household one of them is in, and who would join it. */
  existing?: { householdTitle: string; joiningPersonId: string };
};

const fail = (status: number, code: MissioErrorCode, error: string): Fail => ({ ok: false, status, code, error });
const broken = () => fail(500, "server_error", "Something went wrong.");
const missingTable = (code: string | undefined) => code === "42P01" || code === "PGRST205";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type SuggestionRow = { id: string; contact_a: string; contact_b: string; status: string; created_at: string };

function admin(): Db | null {
  try {
    return createAdminClient();
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Reading
// ────────────────────────────────────────────────────────────

/**
 * Pending suggestions, oldest first. With personId, only theirs. A pair
 * where either is no longer a Missio person is left out.
 */
export async function listSuggestions(
  auth: OrgAccess,
  options: { personId?: string } = {}
): Promise<{ ok: true; suggestions: HouseholdSuggestion[] } | Fail> {
  let only: string | null = null;
  if (options.personId) {
    const person = await auth.supabase
      .from("org_people")
      .select("contact_id")
      .eq("id", options.personId)
      .eq("org_id", auth.orgId)
      .maybeSingle();
    if (person.error) return broken();
    only = (person.data as { contact_id?: string } | null)?.contact_id ?? null;
    if (!only) return fail(404, "not_found", "Person not found.");
  }

  const read = await auth.supabase
    .from("missio_household_suggestions")
    .select("id, contact_a, contact_b, status, created_at")
    .eq("org_id", auth.orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (read.error) {
    if (missingTable(read.error.code)) return { ok: true, suggestions: [] };
    console.error("[missio] suggestion read failed", read.error.code ?? "error");
    return broken();
  }
  const rows = ((read.data ?? []) as SuggestionRow[]).filter((row) => !only || row.contact_a === only || row.contact_b === only);
  if (rows.length === 0) return { ok: true, suggestions: [] };

  const contactIds = [...new Set(rows.flatMap((row) => [row.contact_a, row.contact_b]))];
  const db = admin();
  if (!db) return broken();
  const [contacts, people, houses, members] = await Promise.all([
    db.from("contacts").select("id, first_name, preferred_name").in("id", contactIds),
    db.from("org_people").select("id, contact_id").eq("org_id", auth.orgId).in("contact_id", contactIds),
    db.from("house_church_members").select("contact_id, house_church_id").in("contact_id", contactIds).is("ended_at", null),
    auth.supabase.from("missio_household_members").select("contact_id, household_id").in("contact_id", contactIds),
  ]);
  if (contacts.error || people.error || houses.error || members.error) return broken();

  const firstOf = new Map(
    ((contacts.data ?? []) as Array<{ id: string; first_name: string | null; preferred_name: string | null }>).map((row) => [
      row.id,
      (row.preferred_name || row.first_name || "").trim(),
    ])
  );
  const personOf = new Map(((people.data ?? []) as Array<{ id: string; contact_id: string }>).map((row) => [row.contact_id, row.id]));
  const householdOf = new Map(
    ((members.data ?? []) as Array<{ contact_id: string; household_id: string }>).map((row) => [row.contact_id, row.household_id])
  );
  const housesOf = new Map<string, Set<string>>();
  for (const row of (houses.data ?? []) as Array<{ contact_id: string; house_church_id: string }>) {
    housesOf.set(row.contact_id, (housesOf.get(row.contact_id) ?? new Set()).add(row.house_church_id));
  }
  const sharedHouseIds = new Set<string>();
  for (const row of rows) for (const id of housesOf.get(row.contact_a) ?? []) if (housesOf.get(row.contact_b)?.has(id)) sharedHouseIds.add(id);
  const numberOf = new Map<string, number>();
  if (sharedHouseIds.size > 0) {
    const read = await db.from("house_churches").select("id, number").eq("org_id", auth.orgId).in("id", [...sharedHouseIds]);
    if (read.error) return broken();
    for (const row of (read.data ?? []) as Array<{ id: string; number: number }>) numberOf.set(row.id, Number(row.number));
  }

  const suggestions: HouseholdSuggestion[] = [];
  for (const row of rows) {
    const pa = personOf.get(row.contact_a);
    const pb = personOf.get(row.contact_b);
    if (!pa || !pb) continue;
    const shared = [...(housesOf.get(row.contact_a) ?? [])]
      .filter((id) => housesOf.get(row.contact_b)?.has(id))
      .map((id) => numberOf.get(id))
      .filter((n): n is number => typeof n === "number")
      .sort((x, y) => x - y);
    const ha = householdOf.get(row.contact_a) ?? null;
    const hb = householdOf.get(row.contact_b) ?? null;
    suggestions.push({
      id: row.id,
      a: { personId: pa, firstName: firstOf.get(row.contact_a) || "Someone" },
      b: { personId: pb, firstName: firstOf.get(row.contact_b) || "Someone" },
      houseNumber: shared[0] ?? null,
      link: !ha && !hb ? "new" : ha && hb ? (ha === hb ? "same" : "separate") : "join",
    });
  }
  return { ok: true, suggestions };
}

// ────────────────────────────────────────────────────────────
// Reviewing
// ────────────────────────────────────────────────────────────

const reviewSchema = z
  .object({
    action: z.enum(["accept", "dismiss"]),
    /** Second click: yes, add the other one to the household that exists. */
    addToExisting: z.boolean().optional(),
  })
  .strict();

async function mark(auth: OrgAccess, id: string, status: "accepted" | "dismissed"): Promise<"ok" | "gone" | "error"> {
  const saved = await auth.supabase
    .from("missio_household_suggestions")
    .update({ status, reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .eq("status", "pending")
    .select("id");
  if (saved.error) {
    console.error("[missio] suggestion review failed", saved.error.code ?? "error");
    return "error";
  }
  return ((saved.data ?? []) as unknown[]).length > 0 ? "ok" : "gone";
}

/** Link the pair as a household, or dismiss it ("Not a couple"). */
export async function reviewSuggestion(auth: OrgAccess, id: string, body: unknown): Promise<ReviewResult> {
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");

  const read = await auth.supabase
    .from("missio_household_suggestions")
    .select("id, contact_a, contact_b, status, created_at")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();
  if (read.error) return missingTable(read.error.code) ? fail(404, "not_found", "Suggestion not found.") : broken();
  const row = read.data as SuggestionRow | null;
  if (!row) return fail(404, "not_found", "Suggestion not found.");
  if (row.status !== "pending") return fail(409, "already_resolved", "Someone already answered this.");

  if (parsed.data.action === "dismiss") {
    const done = await mark(auth, id, "dismissed");
    if (done === "error") return broken();
    if (done === "gone") return fail(409, "already_resolved", "Someone already answered this.");
    return { ok: true, status: "dismissed", household: null };
  }

  const people = await auth.supabase
    .from("org_people")
    .select("id, contact_id")
    .eq("org_id", auth.orgId)
    .in("contact_id", [row.contact_a, row.contact_b]);
  if (people.error) return broken();
  const personOf = new Map(((people.data ?? []) as Array<{ id: string; contact_id: string }>).map((p) => [p.contact_id, p.id]));
  const personA = personOf.get(row.contact_a);
  const personB = personOf.get(row.contact_b);
  if (!personA || !personB) return fail(409, "not_missio_person", "One of them isn’t a Missio person any more.");

  const [ha, hb] = await Promise.all([householdForContact(auth, row.contact_a), householdForContact(auth, row.contact_b)]);
  if (!ha.ok) return ha;
  if (!hb.ok) return hb;

  let household: Household | null = null;
  if (ha.household && hb.household) {
    if (ha.household.id !== hb.household.id) {
      return fail(409, "both_in_households", "They’re each in a different household.");
    }
    household = ha.household;
  } else if (ha.household || hb.household) {
    const existing = (ha.household ?? hb.household)!;
    const joining = ha.household ? personB : personA;
    if (!parsed.data.addToExisting) {
      return {
        ...fail(409, "household_exists", "One of them is already in a household."),
        existing: { householdTitle: existing.title, joiningPersonId: joining },
      };
    }
    const added = await addHouseholdMember(auth, existing.id, { kind: "adult", personId: joining });
    if (!added.ok) return added;
    household = added.household;
  } else {
    const made = await createHousehold(auth, { personId: personA });
    if (!made.ok) return made;
    const added = await addHouseholdMember(auth, made.household.id, { kind: "adult", personId: personB });
    if (!added.ok) {
      // Undo only the household this click started: A alone, nobody else.
      const lone = made.household.adults;
      if (lone.length === 1 && lone[0]!.contactId === row.contact_a && made.household.children.length === 0) {
        await removeHouseholdMember(auth, made.household.id, lone[0]!.memberId);
      }
      return added;
    }
    household = added.household;
  }

  const done = await mark(auth, id, "accepted");
  // The household is linked either way. If marking failed, the row stays
  // pending and shows "same" next time, where Link only marks it.
  if (done === "error") console.error("[missio] suggestion linked but not marked", id);
  return { ok: true, status: "accepted", household };
}
