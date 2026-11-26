import type { MissioPersonFamily } from "@/lib/missio/types";
import { ageFromBirthYear, isNotSpouseLabel } from "@/lib/missio/family-format";

// Family summaries for the People list. Read only: this module never
// creates, joins or edits a household (that stays in households.ts), and it
// never makes a people row for a child.
//
// Reads go through the signed-in pastor's client, so RLS 341 applies, the
// same way the house pages count children (loadKids). Names of the other
// adults come from org_people_directory, never from contacts directly.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type FamilyMemberRow = {
  household_id: string;
  kind: "adult" | "child";
  contact_id: string | null;
  first_name: string | null;
  birth_year: number | null;
  label: string | null;
  created_at: string | null;
};

export type FamilyAdultName = { personId: string | null; firstName: string };

const MEMBER_COLUMNS = "household_id, kind, contact_id, first_name, birth_year, label, created_at";

function byCreated(a: FamilyMemberRow, b: FamilyMemberRow): number {
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/**
 * Build the summary for each contact on the page from the household rows.
 * Pure, so the copy rules are tested without a database.
 *
 * - Two adults, neither labelled as a relative or friend: the other is the spouse.
 * - Any other shape with more than one adult: every other adult is listed.
 * - Children: first name and an age from the birth year, oldest first.
 * - An adult whose name can't be read is left out rather than guessed.
 */
export function buildFamilies(
  contactIds: string[],
  members: FamilyMemberRow[],
  names: Map<string, FamilyAdultName>,
  now: Date = new Date()
): Map<string, MissioPersonFamily> {
  const byHousehold = new Map<string, FamilyMemberRow[]>();
  for (const row of members) {
    const list = byHousehold.get(row.household_id) ?? [];
    list.push(row);
    byHousehold.set(row.household_id, list);
  }
  const householdOf = new Map<string, string>();
  for (const row of members) {
    if (row.kind === "adult" && row.contact_id) householdOf.set(row.contact_id, row.household_id);
  }

  const out = new Map<string, MissioPersonFamily>();
  for (const contactId of contactIds) {
    const householdId = householdOf.get(contactId);
    if (!householdId) continue;
    const rows = [...(byHousehold.get(householdId) ?? [])].sort(byCreated);
    const adults = rows.filter((row) => row.kind === "adult" && row.contact_id);
    const children = rows
      .filter((row) => row.kind === "child" && (row.first_name ?? "").trim())
      .map((row) => ({ firstName: (row.first_name ?? "").trim(), birthYear: row.birth_year }))
      .sort((a, b) => (a.birthYear ?? Infinity) - (b.birthYear ?? Infinity))
      .map((child) => ({ firstName: child.firstName, age: ageFromBirthYear(child.birthYear, now) }));

    const family: MissioPersonFamily = { householdId, children };
    const others = adults
      .filter((row) => row.contact_id !== contactId)
      .map((row) => {
        const name = names.get(row.contact_id!);
        return name?.firstName.trim()
          ? { personId: name.personId, firstName: name.firstName.trim(), label: row.label?.trim() || null }
          : null;
      })
      .filter((adult): adult is NonNullable<typeof adult> => adult !== null);

    const couple = adults.length === 2 && !adults.some((row) => isNotSpouseLabel(row.label));
    if (couple && others.length === 1) family.spouse = others[0];
    else if (others.length > 0) family.otherAdults = others;
    out.set(contactId, family);
  }
  return out;
}

/**
 * Family summaries for one page of people, by contact id. Best effort: null
 * when any read fails, so the list still loads and no row shows a family
 * (or the lack of one) it couldn't check.
 */
export async function familiesFor(
  supabase: Client,
  orgId: string,
  contactIds: string[],
  now: Date = new Date()
): Promise<Map<string, MissioPersonFamily> | null> {
  if (contactIds.length === 0) return new Map();
  try {
    const mine = await supabase
      .from("missio_household_members")
      .select("household_id, contact_id")
      .eq("kind", "adult")
      .in("contact_id", contactIds);
    if (mine.error) {
      console.error("[missio] people families failed", mine.error.message ?? "query error");
      return null;
    }
    const linked = (mine.data ?? []) as Array<{ household_id: string; contact_id: string }>;
    if (linked.length === 0) return new Map();

    const households = await supabase
      .from("missio_households")
      .select("id")
      .eq("org_id", orgId)
      .in("id", [...new Set(linked.map((row) => row.household_id))]);
    if (households.error) {
      console.error("[missio] people families failed", households.error.message ?? "query error");
      return null;
    }
    const ids = ((households.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return new Map();

    const members = await supabase.from("missio_household_members").select(MEMBER_COLUMNS).in("household_id", ids);
    if (members.error) {
      console.error("[missio] people families failed", members.error.message ?? "query error");
      return null;
    }
    const rows = (members.data ?? []) as FamilyMemberRow[];

    const adultIds = [...new Set(rows.filter((row) => row.kind === "adult" && row.contact_id).map((row) => row.contact_id!))];
    const names = new Map<string, FamilyAdultName>();
    if (adultIds.length > 0) {
      const people = await supabase
        .from("org_people_directory")
        .select("id, contact_id, first_name, preferred_name")
        .eq("org_id", orgId)
        .in("contact_id", adultIds);
      if (people.error) {
        console.error("[missio] people families failed", people.error.message ?? "query error");
        return null;
      }
      for (const row of (people.data ?? []) as Array<{ id: string; contact_id: string; first_name: string | null; preferred_name: string | null }>) {
        names.set(row.contact_id, { personId: row.id, firstName: (row.preferred_name || row.first_name || "").trim() });
      }
    }
    return buildFamilies(contactIds, rows, names, now);
  } catch (error) {
    console.error("[missio] people families failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
