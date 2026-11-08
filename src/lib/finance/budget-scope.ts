/**
 * Owner choices for the budget sheet, plus the South African finance org.
 *
 * These are records the Hub already has (staff ministries, sub-categories,
 * schools, events, finance organisations). A budget's organisation is
 * budgets.org_id and is always the ZA org. Budget tables are not queried —
 * they are not on this branch.
 */

import type { BudgetGate } from "@/lib/finance/budget-access";
import { listFinanceOrgs } from "@/lib/finance/orgs";
import {
  currencyFromRecord,
  type BudgetCurrency,
  type BudgetOwnerKind,
} from "@/lib/finance/budget-sheet";
import { listActiveMinistriesForLinking } from "@/services/ministries";
import { getOutreachTeams } from "@/services/outreach-finance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type BudgetOwnerOption = { id: string; label: string };

export type BudgetOrgOption = {
  id: string;
  name: string;
  key: string;
  region: string;
  currency: BudgetCurrency | null;
  inactive: boolean;
};

type OrgIdentity = {
  id: string;
  key?: string | null;
  region?: string | null;
  xero_region?: string | null;
  is_active?: boolean;
  inactive?: boolean;
};

/**
 * FFSA NPC, active, recording in rand. A US org is never returned, and a
 * ZA-region org with another key is not FFSA NPC.
 */
export function southAfricaBudgetOrg<T extends OrgIdentity & { record_currency?: string | null; currency?: BudgetCurrency | null }>(
  orgs: T[]
): T | null {
  return (
    orgs.find((org) => {
      const currency = (org.record_currency ?? org.currency ?? "").toUpperCase();
      return (
        (org.key ?? "").toLowerCase() === "npc" &&
        currency === "ZAR" &&
        org.is_active !== false &&
        org.inactive !== true
      );
    }) ?? null
  );
}

export type BudgetPeriodOption = {
  id: string;
  org_id: string;
  label: string;
  kind: "year" | "term" | "event";
  start: string;
  end: string;
  current: boolean;
};

/** Periods whose org is FFSA NPC. A US period is dropped, not retargeted. */
export function periodsForNpc<T extends { org_id: string }>(periods: T[], npcId: string | null): T[] {
  if (!npcId) return [];
  return periods.filter((period) => period.org_id === npcId);
}

export type BudgetScopeOptions = {
  owners: Record<BudgetOwnerKind, BudgetOwnerOption[]>;
  orgs: BudgetOrgOption[];
  /** False when finance_orgs could not be read. */
  orgsReadable: boolean;
  /** Real fiscal_periods for FFSA NPC only. */
  periods: BudgetPeriodOption[];
  /** False when fiscal_periods could not be read. */
  periodsReadable: boolean;
};

function rows<T>(result: { data: T[] | null; error: unknown }): T[] {
  if (result.error || !result.data) return [];
  return result.data;
}

const PERIOD_KINDS = new Set(["year", "term", "event"]);

export async function loadBudgetScopeOptions(supabase: Client, gate: BudgetGate): Promise<BudgetScopeOptions> {
  const [ministries, subcategories, programs, events, orgs, teams] = await Promise.all([
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
    getOutreachTeams(supabase),
  ]);

  const ministryName = new Map<string, string>();
  for (const ministry of rows(ministries) as { id: string; name: string }[]) {
    ministryName.set(ministry.id, ministry.name);
  }

  const lead = new Set(gate.leadMinistryIds);
  const ministryRows = (rows(ministries) as { id: string; name: string }[]).filter(
    (ministry) => gate.editAll || lead.has(ministry.id)
  );
  const subOptions = (rows(subcategories) as { id: string; name: string; staff_ministry_id: string }[])
    .filter((sub) => gate.editAll || lead.has(sub.staff_ministry_id))
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
      staff_ministry: ministryRows.map((ministry) => ({
        id: ministry.id,
        label: ministry.name,
      })),
      ministry_subcategory: subOptions,
      // can_create_budget_for allows a program, event, or outreach team only
      // for someone who edits every budget. A ministry lead is not that.
      program: gate.editAll
        ? (rows(programs) as { id: string; name: string; code: string | null }[]).map((program) => ({
            id: program.id,
            label: program.code ? `${program.name} (${program.code})` : program.name,
          }))
        : [],
      event: gate.editAll
        ? (rows(events) as { id: string; title: string; start_date: string | null }[]).map((event) => ({
            id: event.id,
            label: event.start_date ? `${event.title} · ${event.start_date}` : event.title,
          }))
        : [],
      outreach_team: gate.editAll
        ? (rows(teams) as { id: string; team_name: string; start_date: string | null }[]).map((team) => ({
            id: team.id,
            label: team.start_date ? `${team.team_name} · ${team.start_date}` : team.team_name,
          }))
        : [],
    },
    orgs: (() => {
      const mapped = (rows(orgs) as {
        id: string;
        key: string;
        name: string;
        xero_region: string;
        record_currency: string;
        is_active: boolean;
      }[]).map((org) => ({
        id: org.id,
        name: org.name,
        key: org.key,
        region: org.xero_region,
        currency: currencyFromRecord(org.record_currency),
        inactive: org.is_active === false,
        is_active: org.is_active,
      }));
      const za = southAfricaBudgetOrg(mapped);
      return za
        ? [{ id: za.id, name: za.name, key: za.key, region: za.region, currency: za.currency, inactive: za.inactive }]
        : [];
    })(),
    orgsReadable: !orgs.error,
    ...(await loadNpcPeriods(supabase, southAfricaBudgetOrg(
      (rows(orgs) as { id: string; key: string; record_currency: string; is_active: boolean }[]).map((org) => ({
        id: org.id,
        key: org.key,
        record_currency: org.record_currency,
        is_active: org.is_active,
      }))
    )?.id ?? null)),
  };
}

async function loadNpcPeriods(
  supabase: Client,
  npcId: string | null
): Promise<{ periods: BudgetPeriodOption[]; periodsReadable: boolean }> {
  if (!npcId) return { periods: [], periodsReadable: true };
  const result = await supabase
    .from("fiscal_periods")
    .select("id, org_id, label, kind, start_date, end_date, is_current")
    .eq("org_id", npcId)
    .is("archived_at", null)
    .order("start_date", { ascending: false });
  if (result.error || !Array.isArray(result.data)) return { periods: [], periodsReadable: false };
  const parsed: BudgetPeriodOption[] = [];
  for (const row of result.data as {
    id: string;
    org_id: string;
    label: string;
    kind: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
  }[]) {
    if (!PERIOD_KINDS.has(row.kind) || row.org_id !== npcId) continue;
    parsed.push({
      id: row.id,
      org_id: row.org_id,
      label: row.label,
      kind: row.kind as BudgetPeriodOption["kind"],
      start: row.start_date,
      end: row.end_date,
      current: row.is_current === true,
    });
  }
  return { periods: periodsForNpc(parsed, npcId), periodsReadable: true };
}
