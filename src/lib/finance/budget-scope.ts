/**
 * Owner and organisation choices for the budget sheet.
 *
 * These are records the Hub already has (staff ministries, sub-categories,
 * schools, events, finance organisations). Budget tables are not queried —
 * they are not on this branch.
 */

import { listFinanceOrgs } from "@/lib/finance/orgs";
import {
  currencyFromRecord,
  type BudgetCurrency,
  type BudgetOwnerKind,
} from "@/lib/finance/budget-sheet";
import { listActiveMinistriesForLinking } from "@/services/ministries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type BudgetOwnerOption = { id: string; label: string };

export type BudgetOrgOption = {
  id: string;
  name: string;
  currency: BudgetCurrency | null;
  inactive: boolean;
};

export type BudgetScopeOptions = {
  owners: Record<BudgetOwnerKind, BudgetOwnerOption[]>;
  orgs: BudgetOrgOption[];
  /** False when finance_orgs could not be read. */
  orgsReadable: boolean;
};

function rows<T>(result: { data: T[] | null; error: unknown }): T[] {
  if (result.error || !result.data) return [];
  return result.data;
}

export async function loadBudgetScopeOptions(supabase: Client): Promise<BudgetScopeOptions> {
  const [ministries, subcategories, programs, events, orgs] = await Promise.all([
    listActiveMinistriesForLinking(supabase),
    supabase
      .from("staff_ministry_subcategories")
      .select("id, name, staff_ministry_id")
      .order("name"),
    supabase.from("programs").select("id, name, code").order("name"),
    supabase
      .from("events")
      .select("id, title, start_date")
      .order("start_date", { ascending: false })
      .limit(200),
    listFinanceOrgs(supabase),
  ]);

  const ministryName = new Map<string, string>();
  for (const ministry of rows(ministries) as { id: string; name: string }[]) {
    ministryName.set(ministry.id, ministry.name);
  }

  const subOptions = (rows(subcategories) as { id: string; name: string; staff_ministry_id: string }[])
    .map((sub) => {
      const parent = ministryName.get(sub.staff_ministry_id);
      return {
        id: sub.id,
        label: parent ? `${parent} · ${sub.name}` : sub.name,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    owners: {
      staff_ministry: (rows(ministries) as { id: string; name: string }[]).map((ministry) => ({
        id: ministry.id,
        label: ministry.name,
      })),
      ministry_subcategory: subOptions,
      program: (rows(programs) as { id: string; name: string; code: string | null }[]).map((program) => ({
        id: program.id,
        label: program.code ? `${program.name} (${program.code})` : program.name,
      })),
      event: (rows(events) as { id: string; title: string; start_date: string | null }[]).map((event) => ({
        id: event.id,
        label: event.start_date ? `${event.title} · ${event.start_date}` : event.title,
      })),
    },
    orgs: (rows(orgs) as { id: string; name: string; record_currency: string; is_active: boolean }[])
      .map((org) => ({
        id: org.id,
        name: org.name,
        currency: currencyFromRecord(org.record_currency),
        inactive: org.is_active === false,
      }))
      .sort((a, b) => Number(a.inactive) - Number(b.inactive) || a.name.localeCompare(b.name)),
    orgsReadable: !orgs.error,
  };
}
