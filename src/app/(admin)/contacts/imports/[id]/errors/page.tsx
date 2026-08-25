import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireModuleAccess } from "@/lib/require-permission";
import { getCsvImport } from "@/services/csv-imports";
import { listImportErrors } from "@/services/csv-import-errors";
import { ErrorsList } from "./errors-list";
import { ReconstructErrorsForm } from "./reconstruct-errors-form";
import { Masthead, MastheadAction, Chip } from "@/components/ffsa";

type SearchParams = { status?: string };

export default async function ImportErrorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: importId } = await params;
  const sp = await searchParams;
  const statusFilter = (sp.status ?? "pending") as
    | "pending"
    | "resolved"
    | "dismissed"
    | "all";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  const importRow = await getCsvImport(supabase, importId);
  if (importRow.error || !importRow.data) notFound();
  const imp = importRow.data;

  const errorsResult = await listImportErrors(supabase, importId, {
    status: statusFilter,
  });
  const errors = errorsResult.data ?? [];

  // Counts per status — render in the filter tabs.
  const [pendingCount, resolvedCount, dismissedCount] = await Promise.all([
    countByStatus(supabase, importId, "pending"),
    countByStatus(supabase, importId, "resolved"),
    countByStatus(supabase, importId, "dismissed"),
  ]);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Import · ${imp.filename}`}
        title="Errored rows"
        actions={<MastheadAction href="/contacts/import">All imports</MastheadAction>}
      />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Imported {new Date(imp.created_at).toLocaleString("en-ZA")}. Fix &amp;
        retry to land them as contacts, or dismiss to clear them from the queue.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-5 py-3 md:px-8">
        <FilterTab
          importId={importId}
          status="pending"
          current={statusFilter}
          label="Pending"
          count={pendingCount}
        />
        <FilterTab
          importId={importId}
          status="resolved"
          current={statusFilter}
          label="Resolved"
          count={resolvedCount}
        />
        <FilterTab
          importId={importId}
          status="dismissed"
          current={statusFilter}
          label="Dismissed"
          count={dismissedCount}
        />
        <FilterTab
          importId={importId}
          status="all"
          current={statusFilter}
          label="All"
          count={pendingCount + resolvedCount + dismissedCount}
        />
      </div>

      <div className="px-5 py-6 md:px-8 md:py-7">
      {errors.length === 0 ? (
        <div className="border border-ink bg-white p-8 text-center">
          <p className="mono-label">
            {statusFilter === "pending"
              ? "No pending errors"
              : `No ${statusFilter} errors`}
          </p>
          {statusFilter === "pending" && pendingCount === 0 && imp.error_count > 0 && resolvedCount + dismissedCount === 0 && (
            <ReconstructPrompt importId={importId} expectedCount={imp.error_count} />
          )}
        </div>
      ) : (
        <ErrorsList
          importId={importId}
          errors={errors as ErrorRow[]}
          status={statusFilter}
        />
      )}
      </div>
    </div>
  );
}

type ErrorRow = {
  id: string;
  row_index: number;
  raw_row: Record<string, unknown>;
  error_message: string;
  error_code: string;
  status: "pending" | "resolved" | "dismissed";
  resolved_contact_id: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

async function countByStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  importId: string,
  status: "pending" | "resolved" | "dismissed"
): Promise<number> {
  const { count } = await supabase
    .from("csv_import_errors")
    .select("id", { count: "exact", head: true })
    .eq("import_id", importId)
    .eq("status", status);
  return count ?? 0;
}

function FilterTab({
  importId,
  status,
  current,
  label,
  count,
}: {
  importId: string;
  status: "pending" | "resolved" | "dismissed" | "all";
  current: "pending" | "resolved" | "dismissed" | "all";
  label: string;
  count: number;
}) {
  const active = status === current;
  return (
    <Link href={`/contacts/imports/${importId}/errors?status=${status}`}>
      <Chip active={active}>
        {label}
        <span className="tabular-nums">{count.toLocaleString("en-ZA")}</span>
      </Chip>
    </Link>
  );
}

function ReconstructPrompt({
  importId,
  expectedCount,
}: {
  importId: string;
  expectedCount: number;
}) {
  return (
    <div className="mt-6 border border-amber-border bg-yellow-dim p-4 text-left">
      <p className="mb-1 text-sm font-semibold text-[color:var(--amber)]">
        This import recorded {expectedCount.toLocaleString()} errored rows but
        none are logged here.
      </p>
      <p className="mb-3 text-xs text-[color:var(--text-secondary)]">
        That means the import ran before per-row error capture was deployed.
        Re-upload the original CSV below and we&apos;ll reconstruct the lost
        errors by comparing each row to what landed in contacts.
      </p>
      <ReconstructErrorsForm importId={importId} />
    </div>
  );
}
