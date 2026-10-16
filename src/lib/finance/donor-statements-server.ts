// Donor statements — server side: who may use it, and loading a run's
// review (lines + edits + settings → buildStatements). Routes stay thin.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import {
  buildStatements,
  donorKey,
  DEFAULT_RUN_OPTIONS,
  type DonorEdit,
  type ImportRules,
  type RunOptions,
  type SourceLine,
  type StatementBuild,
} from "./donor-statements";

export const DONOR_STATEMENTS_BUCKET = "donor-statements";

// donor_statement_* (migration 245) aren't in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dsDb = () => createAdminClient() as any;

/**
 * Finance managers, or anyone granted finance.donor_statements (directly or
 * through a role). Uses the same SQL function as the RLS policies.
 */
export async function authorizeDonorStatements() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("can_manage_donor_statements");
  const allowed = error ? await canManageFinance(supabase, user.id) : data === true;
  if (!allowed) return { error: "Not authorized", status: 403 as const };
  return { user };
}

export type DonorStatementSettings = {
  org_name: string;
  tax_id: string;
  address_line1: string;
  address_line2: string;
  address_city_line: string;
  signer_name: string;
  signer_title: string;
  logo_path: string | null;
  signature_path: string | null;
  account_codes: string[];
  excluded_item_codes: string[];
  excluded_line_phrases: string[];
  review_line_phrases: string[];
  organisation_phrases: string[];
  // Migration 246 — absent until applied; the wording falls back to defaults.
  from_name?: string;
  from_email?: string;
  reply_to?: string;
  email_subject?: string;
  email_body?: string;
  mission_paragraph?: string;
  irs_paragraph?: string;
  closing_line?: string;
  updated_at: string;
};

export const EDITABLE_TEXT_SETTINGS = [
  "org_name", "tax_id", "address_line1", "address_line2", "address_city_line", "signer_name", "signer_title",
  "from_name", "from_email", "reply_to", "email_subject", "email_body", "mission_paragraph", "irs_paragraph", "closing_line",
] as const;
export const EMAIL_SETTINGS = ["from_email", "reply_to"] as const;
export const EDITABLE_LIST_SETTINGS = [
  "account_codes", "excluded_item_codes", "excluded_line_phrases", "review_line_phrases", "organisation_phrases",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSettings(admin: any): Promise<DonorStatementSettings | null> {
  const { data } = await admin.from("donor_statement_settings").select("*").eq("id", true).maybeSingle();
  return data ?? null;
}

export function rulesFromSettings(s: DonorStatementSettings | null): Partial<ImportRules> {
  if (!s) return {};
  return {
    accountCodes: s.account_codes,
    excludedItemCodes: s.excluded_item_codes,
    excludedLinePhrases: s.excluded_line_phrases,
    reviewLinePhrases: s.review_line_phrases,
    organisationPhrases: s.organisation_phrases,
  };
}

export type RunRow = {
  id: string;
  tax_year: number;
  source: "xero" | "upload";
  source_file_name: string | null;
  options: Partial<RunOptions>;
  contact_emails: Record<string, string>;
  status: "draft" | "archived";
  imported_at: string;
  created_at: string;
};

/** Every line of a run — paged, because PostgREST stops at 1000 rows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadLines(admin: any, runId: string): Promise<SourceLine[]> {
  const out: SourceLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("donor_statement_lines")
      .select("*")
      .eq("run_id", runId)
      .order("position")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      out.push({
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        contactName: r.contact_name,
        contactId: r.contact_id,
        email: r.email,
        itemCode: r.item_code,
        description: r.description,
        accountCode: r.account_code,
        quantity: Number(r.quantity),
        unitPriceUsd: Number(r.unit_price_usd),
        invoiceTotalUsd: r.invoice_total_usd === null ? null : Number(r.invoice_total_usd),
        currency: r.currency,
        status: r.status,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/**
 * Hub contacts whose "first last" matches a donor exactly, for donors with
 * no email anywhere else. A name shared by two contacts with different
 * emails is ambiguous and skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hubEmailsFor(admin: any, names: string[]): Promise<Record<string, string>> {
  const wanted = new Set(names.map(donorKey));
  const lastNames = [...new Set(names.map((n) => n.trim().split(/\s+/).pop() ?? "").filter((l) => l.length > 1))];
  const found = new Map<string, Set<string>>();
  for (let i = 0; i < lastNames.length; i += 100) {
    const { data } = await admin
      .from("contacts")
      .select("first_name, last_name, email")
      .in("last_name", lastNames.slice(i, i + 100))
      .not("email", "is", null)
      .limit(1000);
    for (const c of data ?? []) {
      const key = donorKey(`${c.first_name ?? ""} ${c.last_name ?? ""}`);
      if (!wanted.has(key) || !c.email) continue;
      (found.get(key) ?? found.set(key, new Set()).get(key)!).add(String(c.email).trim().toLowerCase());
    }
  }
  const out: Record<string, string> = {};
  for (const [k, emails] of found) if (emails.size === 1) out[k] = [...emails][0];
  return out;
}

export type RunReview = { run: RunRow; build: StatementBuild; options: RunOptions };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRunReview(admin: any, runId: string): Promise<RunReview | null> {
  const { data: run } = await admin.from("donor_statement_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return null;
  const [lines, settings, editsRes] = await Promise.all([
    loadLines(admin, runId),
    loadSettings(admin),
    admin.from("donor_statement_donor_edits").select("*").eq("run_id", runId),
  ]);
  const edits: DonorEdit[] = (editsRes.data ?? []).map((e: Record<string, unknown>) => ({
    donorKey: e.donor_key as string,
    email: (e.email as string) ?? null,
    displayName: (e.display_name as string) ?? null,
    excluded: e.excluded === true,
    mergeIntoKey: (e.merge_into_key as string) ?? null,
    note: (e.note as string) ?? null,
  }));
  const options: RunOptions = { ...DEFAULT_RUN_OPTIONS, ...(run.options ?? {}) };
  const input = {
    lines,
    taxYear: run.tax_year,
    options,
    rules: rulesFromSettings(settings),
    contactEmails: run.contact_emails ?? {},
    edits,
  };
  // First pass finds who still has no email; only those are looked up in the Hub.
  const first = buildStatements(input);
  const missing = first.donors.filter((d) => !d.email).map((d) => d.name);
  const hubEmails = missing.length ? await hubEmailsFor(admin, missing) : {};
  const build = Object.keys(hubEmails).length ? buildStatements({ ...input, hubEmails }) : first;
  return { run, build, options };
}

// ── Phase 2: one donor's statement ───────────────────────────

export type StatementImages = {
  logo: { data: Buffer; format: "png" | "jpg" } | null;
  signature: { data: Buffer; format: "png" | "jpg" } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadStatementImages(admin: any, s: DonorStatementSettings | null): Promise<StatementImages> {
  const load = async (path: string | null | undefined) => {
    if (!path) return null;
    const { data, error } = await admin.storage.from(DONOR_STATEMENTS_BUCKET).download(path);
    if (error || !data) return null;
    return { data: Buffer.from(await data.arrayBuffer()), format: /\.png$/i.test(path) ? ("png" as const) : ("jpg" as const) };
  };
  const [logo, signature] = await Promise.all([load(s?.logo_path), load(s?.signature_path)]);
  return { logo, signature };
}

/** A run's review plus one donor in it, and the settings to print with. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDonorStatement(admin: any, runId: string, key: string) {
  const [review, settings] = await Promise.all([loadRunReview(admin, runId), loadSettings(admin)]);
  if (!review) return { error: "Run not found", status: 404 as const };
  if (!settings) return { error: "Settings missing — apply migration 245.", status: 500 as const };
  const donor = review.build.donors.find((d) => d.key === key);
  if (!donor) return { error: "Donor not found in this run", status: 404 as const };
  return { review, donor, settings };
}
