import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { canAccessRecordsLibrary } from "@/lib/auth/records-library-access";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findPersonByEmail,
  createPerson,
  createApplication,
  createPayment,
  createEnrollment,
  createDocument,
  type ColumnMapping,
  type RecordType,
  PERSON_FIELDS,
  coreFieldsForRecordType,
} from "@/services/records-library";

type CsvRow = Record<string, string | null | undefined>;

type Summary = {
  persons_created: number;
  records_created: number;
  records_merged: number;
  records_skipped: number;
  auto_linked_count: number;
  queued_count: number;
  error_count: number;
  processed: number;
};

// Stable hash of the row content. Keys are sorted so the hash is
// deterministic regardless of CSV column order, and we include the
// typed core fields alongside raw_data so a row with the same raw
// data but different mapping still gets a unique hash.
function computeContentHash(
  core: Record<string, unknown>,
  raw: Record<string, unknown>
): string {
  const normalized = JSON.stringify(
    { core, raw },
    Object.keys({ ...core, ...raw }).sort()
  );
  return createHash("sha256").update(normalized).digest("hex");
}

const DEDUP_TABLE: Record<RecordType, string> = {
  application: "library_applications",
  payment: "library_payments",
  enrollment: "library_enrollments",
  document: "library_documents",
};

// Fields used to identify "the same record" across re-imports — the
// importer first looks for an existing row matching ALL non-null
// values from these fields (per-person), and if found, fills in
// previously-empty columns/raw_data keys instead of inserting a new
// row. Fall-through is the byte-for-byte content hash.
const MERGE_KEYS: Record<RecordType, readonly string[]> = {
  application: ["program_name", "cohort"],
  payment: ["paid_at", "amount", "currency"],
  enrollment: ["school_name", "start_date"],
  document: ["doc_type", "identifier"],
};

function isEmpty(v: unknown): boolean {
  return v == null || v === "";
}

/**
 * "Fill the gaps" merge — for each key in `incoming` whose value is
 * non-empty, set on the result only when the existing value is
 * empty. Never overwrites populated existing data.
 */
function mergeFilling<T extends Record<string, unknown>>(
  existing: T,
  incoming: Partial<T>
): { merged: T; changed: boolean } {
  const merged: Record<string, unknown> = { ...existing };
  let changed = false;
  for (const [k, v] of Object.entries(incoming)) {
    if (isEmpty(v)) continue;
    if (!isEmpty(existing[k])) continue;
    merged[k] = v;
    changed = true;
  }
  return { merged: merged as T, changed };
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: importId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminSupabase: any = createAdminClient();

  // Load the import record so we know record_type + mapping.
  const { data: importRow, error: importErr } = await adminSupabase
    .from("library_imports")
    .select("*")
    .eq("id", importId)
    .maybeSingle();

  if (importErr || !importRow) {
    return NextResponse.json({ error: "Import not found" }, { status: 404 });
  }

  // Authz — same gate as the create endpoint.
  const allowed = await canAccessRecordsLibrary(adminSupabase, user.id);
  if (!allowed) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { rows?: CsvRow[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "rows must be an array" }, { status: 400 });
  }

  const recordType = importRow.record_type as RecordType;
  const mapping = importRow.column_mapping as ColumnMapping;
  const personCoreFields = new Set<string>(PERSON_FIELDS);
  const recordCoreFields = new Set<string>(coreFieldsForRecordType(recordType));

  const totals: Summary = {
    persons_created: 0,
    records_created: 0,
    records_merged: 0,
    records_skipped: 0,
    auto_linked_count: 0,
    queued_count: 0,
    error_count: 0,
    processed: 0,
  };
  const errors: Array<{ index: number; message: string }> = [];

  const rowsToProcess: CsvRow[] = body.rows;
  for (let i = 0; i < rowsToProcess.length; i++) {
    const raw: CsvRow = rowsToProcess[i];
    totals.processed += 1;

    try {
      // Split the row into typed person fields, typed record fields, and
      // raw_data. We ALWAYS preserve every CSV column in raw_data so the
      // form-response view on /records-library/persons/[id] is a complete
      // picture of the original CSV row — even the columns that were also
      // mapped to typed columns (first_name, email, status, etc.) stay
      // visible there. The typed columns still get populated for dedup /
      // indexing / sortable display elsewhere.
      const personPart: Record<string, unknown> = {};
      const recordPart: Record<string, unknown> = {};
      const rawData: Record<string, unknown> = {};

      for (const [csvCol, value] of Object.entries(raw ?? {}) as Array<[string, string | null | undefined]>) {
        const target = mapping[csvCol];
        const cleaned = normalizeValue(value);

        // Always keep the column in raw_data (complete CSV view).
        if (csvCol) rawData[csvCol] = cleaned;

        // Additionally populate typed columns if this column was mapped.
        if (!target || target === "raw") continue;
        if (personCoreFields.has(target)) {
          personPart[target] = cleaned;
        } else if (recordCoreFields.has(target)) {
          recordPart[target] = cleaned;
        }
      }

      const email =
        typeof personPart.email === "string" ? (personPart.email as string) : null;
      const lastName =
        typeof personPart.last_name === "string"
          ? (personPart.last_name as string)
          : null;

      // 1. Find-or-create the person.
      let personId: string | null = null;
      if (email) {
        const existing = await findPersonByEmail(adminSupabase, email, lastName);
        if (existing.data?.id) personId = existing.data.id;
      }

      if (!personId) {
        const personInsert = {
          email: (personPart.email as string) ?? null,
          first_name: (personPart.first_name as string) ?? null,
          last_name: (personPart.last_name as string) ?? null,
          preferred_name: (personPart.preferred_name as string) ?? null,
          date_of_birth: parseDate(personPart.date_of_birth),
          phone: (personPart.phone as string) ?? null,
          nationality: (personPart.nationality as string) ?? null,
          country: (personPart.country as string) ?? null,
          source_import_id: importId,
          raw_data: rawData,
        };
        const created = await createPerson(adminSupabase, personInsert);
        if (created.error || !created.data) {
          throw new Error(created.error?.message ?? "Failed to create person");
        }
        personId = created.data.id;
        totals.persons_created += 1;
      }

      // 2. Build the typed core column object for this record type. Date
      //    fields go through parseDate; amounts go through parseAmount.
      //    Everything else flows straight through. This is the "incoming"
      //    record's core column set.
      const incomingCore: Record<string, unknown> = {};
      if (recordType === "application") {
        incomingCore.program_name = (recordPart.program_name as string) ?? null;
        incomingCore.cohort = (recordPart.cohort as string) ?? null;
        incomingCore.status = (recordPart.status as string) ?? null;
        incomingCore.submitted_at = parseDate(recordPart.submitted_at);
      } else if (recordType === "payment") {
        incomingCore.amount = parseAmount(recordPart.amount);
        incomingCore.currency = (recordPart.currency as string) ?? null;
        incomingCore.description = (recordPart.description as string) ?? null;
        incomingCore.paid_at = parseDate(recordPart.paid_at);
      } else if (recordType === "enrollment") {
        incomingCore.school_name = (recordPart.school_name as string) ?? null;
        incomingCore.program_name = (recordPart.program_name as string) ?? null;
        incomingCore.role = (recordPart.role as string) ?? null;
        incomingCore.start_date = parseDate(recordPart.start_date);
        incomingCore.end_date = parseDate(recordPart.end_date);
      } else if (recordType === "document") {
        incomingCore.doc_type = (recordPart.doc_type as string) ?? null;
        incomingCore.file_url = (recordPart.file_url as string) ?? null;
        incomingCore.identifier = (recordPart.identifier as string) ?? null;
        incomingCore.expires_at = parseDate(recordPart.expires_at);
      }

      const dedupTable = DEDUP_TABLE[recordType];

      // 3. Try a typed-key lookup first: find an existing record on this
      //    person that shares all the non-empty MERGE_KEYS values from
      //    the incoming row. This is the "same application / same
      //    payment / etc." case where we want to fill gaps rather than
      //    duplicate.
      const mergeKeyFields = MERGE_KEYS[recordType];
      const lookupFilters: Record<string, unknown> = {};
      for (const k of mergeKeyFields) {
        const v = incomingCore[k];
        if (!isEmpty(v)) lookupFilters[k] = v;
      }

      let existing: Record<string, unknown> | null = null;
      if (Object.keys(lookupFilters).length > 0) {
        let q = adminSupabase
          .from(dedupTable)
          .select("*")
          .eq("person_id", personId!);
        for (const [k, v] of Object.entries(lookupFilters)) {
          q = q.eq(k, v);
        }
        const lookupRes = await q.limit(2);
        if (lookupRes.data && lookupRes.data.length === 1) {
          existing = lookupRes.data[0];
        }
        // If 2+ matches, the typed key is ambiguous → fall through to
        // content-hash check / insert.
      }

      // 4. If we found exactly one existing record by typed key, merge.
      if (existing) {
        const { merged: mergedCore, changed: coreChanged } = mergeFilling(
          existing,
          incomingCore
        );
        const existingRaw =
          (existing.raw_data as Record<string, unknown> | null) ?? {};
        const { merged: mergedRaw, changed: rawChanged } = mergeFilling(
          existingRaw,
          rawData
        );

        if (!coreChanged && !rawChanged) {
          // Nothing new to fill — pure dup.
          totals.records_skipped += 1;
          continue;
        }

        // Recompute the content hash from the merged content so future
        // re-imports of the same merged result skip cleanly.
        const newHash = computeContentHash(mergedCore, mergedRaw);
        const updatePayload: Record<string, unknown> = {
          raw_data: mergedRaw,
          content_hash: newHash,
        };
        for (const k of Object.keys(incomingCore)) {
          updatePayload[k] = mergedCore[k];
        }
        const upd = await adminSupabase
          .from(dedupTable)
          .update(updatePayload)
          .eq("id", existing.id as string);
        if (upd.error) {
          throw new Error(upd.error.message ?? "Failed to merge record");
        }
        totals.records_merged += 1;
        continue;
      }

      // 5. No typed-key match — check for a byte-for-byte content-hash
      //    duplicate before inserting (handles the "no typed key" case
      //    and the "same person legitimately has multiple rows but the
      //    typed key is ambiguous" case).
      const contentHash = computeContentHash(incomingCore, rawData);
      const dupCheck = await adminSupabase
        .from(dedupTable)
        .select("id")
        .eq("person_id", personId!)
        .eq("content_hash", contentHash)
        .limit(1)
        .maybeSingle();

      if (dupCheck.data?.id) {
        totals.records_skipped += 1;
        continue;
      }

      // 6. Otherwise, INSERT as a new record.
      const recordBase = {
        person_id: personId!,
        import_id: importId,
        raw_data: rawData,
        content_hash: contentHash,
      };

      let createErr: { message?: string } | null = null;
      if (recordType === "application") {
        const res = await createApplication(adminSupabase, {
          ...recordBase,
          program_name: incomingCore.program_name as string | null,
          cohort: incomingCore.cohort as string | null,
          status: incomingCore.status as string | null,
          submitted_at: incomingCore.submitted_at as string | null,
        });
        createErr = res.error ?? null;
      } else if (recordType === "payment") {
        const res = await createPayment(adminSupabase, {
          ...recordBase,
          amount: incomingCore.amount as number | null,
          currency: incomingCore.currency as string | null,
          description: incomingCore.description as string | null,
          paid_at: incomingCore.paid_at as string | null,
        });
        createErr = res.error ?? null;
      } else if (recordType === "enrollment") {
        const res = await createEnrollment(adminSupabase, {
          ...recordBase,
          school_name: incomingCore.school_name as string | null,
          program_name: incomingCore.program_name as string | null,
          role: incomingCore.role as string | null,
          start_date: incomingCore.start_date as string | null,
          end_date: incomingCore.end_date as string | null,
        });
        createErr = res.error ?? null;
      } else if (recordType === "document") {
        const res = await createDocument(adminSupabase, {
          ...recordBase,
          doc_type: incomingCore.doc_type as string | null,
          file_url: incomingCore.file_url as string | null,
          identifier: incomingCore.identifier as string | null,
          expires_at: incomingCore.expires_at as string | null,
        });
        createErr = res.error ?? null;
      }

      if (createErr) throw new Error(createErr.message ?? "Failed to create record");
      totals.records_created += 1;
    } catch (err) {
      totals.error_count += 1;
      errors.push({
        index: i,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update aggregates on the import row.
  if (errors.length > 0) {
    await adminSupabase
      .from("library_imports")
      .update({
        error_log: errors,
      })
      .eq("id", importId);
  }

  // Increment counters atomically by reading + writing (small batches, fine).
  const current = await adminSupabase
    .from("library_imports")
    .select(
      "persons_created, records_created, merged_count, skipped_count, error_count"
    )
    .eq("id", importId)
    .maybeSingle();

  const currentData = current.data as
    | {
        persons_created: number;
        records_created: number;
        merged_count: number | null;
        skipped_count: number | null;
        error_count: number;
      }
    | null;
  if (currentData) {
    await adminSupabase
      .from("library_imports")
      .update({
        persons_created:
          (currentData.persons_created ?? 0) + totals.persons_created,
        records_created:
          (currentData.records_created ?? 0) + totals.records_created,
        merged_count:
          (currentData.merged_count ?? 0) + totals.records_merged,
        skipped_count:
          (currentData.skipped_count ?? 0) + totals.records_skipped,
        error_count: (currentData.error_count ?? 0) + totals.error_count,
      })
      .eq("id", importId);
  }

  return NextResponse.json(totals);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function normalizeValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return String(v);
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

// Accepts: "16/8/04", "16/8/2004", "2004-08-16".
// Slash-separated values are parsed as day-first (DD/MM/YYYY) to match the
// app's date input convention. 2-digit years <30 → 2000+, else 1900+.
function parseDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // ISO already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yy(yy) — day-first.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    let yy = parseInt(m[3], 10);
    if (m[3].length === 2) yy = yy < 30 ? 2000 + yy : 1900 + yy;
    if (mm > 12 || dd > 31) return null;
    return `${yy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  }

  // Fallback: try Date.parse.
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
