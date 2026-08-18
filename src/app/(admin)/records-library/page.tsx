import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listImports, listPersons } from "@/services/records-library";
import { bestPersonName } from "@/lib/person-name";
import {
  Masthead,
  MastheadAction,
  NeedsYou,
  NeedsYouAction,
  StatusPill,
  type Tone,
} from "@/components/ffsa";

export default async function RecordsLibraryPage() {
  const supabase = await createClient();
  // Middleware already validated; read session from cookie.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  // Permission check + the three independent fetches all run together — used
  // to be 4 serial round-trips (~500ms waterfall), now a single batch (~150ms).
  const [, importsRes, personsRes, queueResult] = await Promise.all([
    requireModuleAccess(supabase, user.id, "records-library"),
    listImports(supabase, { limit: 20 }),
    listPersons(supabase, { limit: 10 }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("library_match_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const recentImports = importsRes.data ?? [];
  const recentPersons = personsRes.data ?? [];
  const totalPersons = personsRes.count ?? 0;
  const pendingQueueCount = queueResult.count;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Records library"
        title="Records library"
        actions={
          <>
            <MastheadAction href="/records-library/persons">
              All persons
            </MastheadAction>
            <MastheadAction href="/records-library/match-queue">
              Match queue{pendingQueueCount ? ` (${pendingQueueCount})` : ""}
            </MastheadAction>
            <MastheadAction href="/records-library/import">
              Upload CSV
            </MastheadAction>
          </>
        }
      />

      {/* The page's ONE yellow band — partial matches waiting on a human. */}
      {(pendingQueueCount ?? 0) > 0 && (
        <NeedsYou
          action={
            <NeedsYouAction href="/records-library/match-queue">
              Review
            </NeedsYouAction>
          }
        >
          {pendingQueueCount === 1
            ? "1 record partially matched a user and needs a decision"
            : `${pendingQueueCount} records partially matched a user and need a decision`}
        </NeedsYou>
      )}

      <div className="space-y-8 px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-3xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            Upload CSVs of historical staff/student data — applications,
            payments, schools attended, documents. When a user is invited or
            signs up, matching records auto-attach to their profile.
        </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Library persons" value={totalPersons} />
        <StatCard
          label="Imports completed"
          value={recentImports.filter((i: ImportRow) => i.status === "completed").length}
        />
        <StatCard
          label="Pending match reviews"
          value={pendingQueueCount ?? 0}
          highlight={(pendingQueueCount ?? 0) > 0}
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent imports</h2>
        {recentImports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet. Upload your first CSV to begin.</p>
        ) : (
          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">File</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Rows</th>
                  <th className="text-right px-3 py-2 font-medium">Persons</th>
                  <th className="text-right px-3 py-2 font-medium">Records</th>
                  <th className="text-right px-3 py-2 font-medium">Merged</th>
                  <th className="text-right px-3 py-2 font-medium">Skipped</th>
                  <th className="text-right px-3 py-2 font-medium">Auto-linked</th>
                  <th className="text-right px-3 py-2 font-medium">Queued</th>
                  <th className="text-right px-3 py-2 font-medium">Errors</th>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {recentImports.map((row: ImportRow) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/records-library/imports/${row.id}`}
                        className="text-foreground hover:underline"
                      >
                        {row.filename}
                      </Link>
                    </td>
                    <td className="px-3 py-2 capitalize">{row.record_type}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-2 text-right">{row.row_count}</td>
                    <td className="px-3 py-2 text-right">{row.persons_created}</td>
                    <td className="px-3 py-2 text-right">{row.records_created}</td>
                    <td className="px-3 py-2 text-right">{row.merged_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">{row.skipped_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">{row.auto_linked_count}</td>
                    <td className="px-3 py-2 text-right">{row.queued_count}</td>
                    <td className="px-3 py-2 text-right">{row.error_count}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recently added persons</h2>
        {recentPersons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No library persons yet.</p>
        ) : (
          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">DOB</th>
                  <th className="text-left px-3 py-2 font-medium">Linked user</th>
                </tr>
              </thead>
              <tbody>
                {recentPersons.map((row: PersonRow) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/records-library/persons/${row.id}`}
                        className="text-foreground hover:underline"
                      >
                        {bestPersonName(row)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.email ?? "—"}</td>
                    <td className="px-3 py-2">{row.date_of_birth ?? "—"}</td>
                    <td className="px-3 py-2">
                      {row.users
                        ? `${row.users.first_name ?? ""} ${row.users.last_name ?? ""}`.trim() ||
                          row.users.email
                        : <span className="text-muted-foreground">Unlinked</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`border border-ink p-4 ${highlight ? "bg-bone" : "bg-white"}`}>
      <div className="mono-label">{label}</div>
      <div className="numeral mt-2 text-[38px] leading-none">{value}</div>
    </div>
  );
}

// Outlined and square on the system's tones. The tints replaced here were
// dark-theme values (emerald-300 on translucent green) from before the light
// redesign — near-invisible on a white page.
const RL_TONE: Record<string, Tone> = {
  completed: "good",
  processing: "warn",
  pending: "warn",
  failed: "bad",
};

function StatusBadge({ status }: { status: string }) {
  return <StatusPill tone={RL_TONE[status] ?? "quiet"}>{status}</StatusPill>;
}

type ImportRow = {
  id: string;
  filename: string;
  record_type: string;
  status: string;
  row_count: number;
  persons_created: number;
  records_created: number;
  merged_count: number | null;
  skipped_count: number | null;
  auto_linked_count: number;
  queued_count: number;
  error_count: number;
  created_at: string;
};

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  raw_data: Record<string, unknown> | null;
  users: { first_name: string | null; last_name: string | null; email: string | null } | null;
};
