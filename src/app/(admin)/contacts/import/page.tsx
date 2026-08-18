import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireModuleAccess } from "@/lib/require-permission";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { listCsvImports } from "@/services/csv-imports";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvImportForm } from "./csv-import-form";
import { UndoImportButton } from "./undo-import-button";
import { Masthead, MastheadAction, SectionBar, StatusPill, type Tone } from "@/components/ffsa";

export default async function ContactsImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  const labelsResult = await getCachedActiveLabels();
  const importsResult = await listCsvImports(supabase, { limit: 10 });

  const labels = labelsResult.data ?? [];
  const recentImports = importsResult.data ?? [];

  return (
    <div className="ffsa-screen">
      <Masthead
        context="People & relationships"
        title="Import contacts"
        actions={<MastheadAction href="/contacts">All contacts</MastheadAction>}
      />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Upload a CSV of contacts, pick a label to apply to every row, and the
        system will dedupe by email or phone as it imports.
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <CsvImportForm labels={labels} />
      </div>

      <section>
        <SectionBar title="Recent imports" meta={`${recentImports.length} shown`} />
        {recentImports.length === 0 ? (
          <p className="px-5 py-8 text-center md:px-8">
            <span className="mono-label">No imports yet</span>
          </p>
        ) : (
          <div className="mx-5 my-6 border border-ink md:mx-8 md:my-7">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="text-right">Matched</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                  <TableHead className="text-right">Errored</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentImports.map((row: ImportRow) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.filename}</TableCell>
                    <TableCell>
                      {row.labels?.name ?? row.custom_label_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.row_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.imported_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.matched_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.review_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.error_count > 0 ? (
                        <Link
                          href={`/contacts/imports/${row.id}/errors`}
                          className="text-red-400 hover:text-red-300 hover:underline"
                        >
                          {row.error_count.toLocaleString()}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <UndoImportButton
                        importId={row.id}
                        filename={row.filename}
                        importedCount={row.imported_count}
                        matchedCount={row.matched_count}
                        status={row.status}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

type ImportRow = {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  imported_count: number;
  matched_count: number;
  review_count: number;
  error_count: number;
  custom_label_name: string | null;
  created_at: string;
  labels: { slug: string; name: string } | null;
};

// Outlined and square on the system's tones — the tints these replaced were
// dark-theme values (emerald-400 on a translucent ground) left over from
// before the light redesign.
const IMPORT_TONE: Record<string, Tone> = {
  completed: "good",
  processing: "warn",
  pending: "warn",
  failed: "bad",
  rolled_back: "quiet",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <StatusPill tone={IMPORT_TONE[status] ?? "quiet"}>
      {status.replace(/_/g, " ")}
    </StatusPill>
  );
}
