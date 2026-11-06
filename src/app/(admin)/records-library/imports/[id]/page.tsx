import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getImport, getRecordsForImport } from "@/services/records-library";
import { bestPersonName } from "@/lib/person-name";
import { Masthead, MastheadAction, StatusPill, type Tone } from "@/components/ffsa";

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "records-library");

  const { data: imp } = await getImport(supabase, id);
  if (!imp) notFound();

  const records = await getRecordsForImport(supabase, id);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Records library import · ${imp.record_type}`}
        title={imp.filename}
        actions={
          <>
            <StatusBadge status={imp.status} />
            <MastheadAction href="/records-library">Library</MastheadAction>
          </>
        }
      />

      <div className="space-y-8 px-5 py-6 md:px-8 md:py-7">
        <p className="mono-label">
          Uploaded {new Date(imp.created_at).toLocaleString("en-ZA")}
        </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Rows in CSV" value={imp.row_count} />
        <Stat label="Persons created" value={imp.persons_created} />
        <Stat label="Records created" value={imp.records_created} />
        <Stat label="Auto-linked" value={imp.auto_linked_count} />
        <Stat label="Errors" value={imp.error_count} />
      </div>

      {imp.error_log && Array.isArray(imp.error_log) && imp.error_log.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">Errors</h2>
          <pre className="text-xs bg-muted/50 border rounded-md p-3 overflow-x-auto max-h-72">
            {JSON.stringify(imp.error_log, null, 2)}
          </pre>
        </section>
      ) : null}

      {records.persons.length > 0 && (
        <Section title={`Persons created (${records.persons.length})`}>
          <Table headers={["Name", "Email", "DOB", "Linked"]}>
            {records.persons.map((p: PersonRow) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2">
                  <Link
                    href={`/records-library/persons/${p.id}`}
                    className="text-foreground hover:underline"
                  >
                    {bestPersonName(p)}
                  </Link>
                </td>
                <td className="px-3 py-2">{p.email ?? "—"}</td>
                <td className="px-3 py-2">{p.date_of_birth ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {p.linked_user_id ? "Linked" : "Unlinked"}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {imp.record_type === "application" && records.applications.length > 0 && (
        <Section title={`Applications (${records.applications.length})`}>
          <Table headers={["Person", "Program", "Cohort", "Status", "Submitted"]}>
            {records.applications.map((r: ApplicationRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <PersonLink p={r.library_persons} />
                </td>
                <td className="px-3 py-2">{r.program_name ?? "—"}</td>
                <td className="px-3 py-2">{r.cohort ?? "—"}</td>
                <td className="px-3 py-2">{r.status ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.submitted_at
                    ? new Date(r.submitted_at).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {imp.record_type === "payment" && records.payments.length > 0 && (
        <Section title={`Payments (${records.payments.length})`}>
          <Table headers={["Person", "Amount", "Currency", "Description", "Paid"]}>
            {records.payments.map((r: PaymentRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <PersonLink p={r.library_persons} />
                </td>
                <td className="px-3 py-2 text-right">
                  {r.amount?.toLocaleString() ?? "—"}
                </td>
                <td className="px-3 py-2">{r.currency ?? "—"}</td>
                <td className="px-3 py-2">{r.description ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.paid_at ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {imp.record_type === "enrollment" && records.enrollments.length > 0 && (
        <Section title={`Enrollments (${records.enrollments.length})`}>
          <Table headers={["Person", "School", "Program", "Role", "Start", "End"]}>
            {records.enrollments.map((r: EnrollmentRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <PersonLink p={r.library_persons} />
                </td>
                <td className="px-3 py-2">{r.school_name ?? "—"}</td>
                <td className="px-3 py-2">{r.program_name ?? "—"}</td>
                <td className="px-3 py-2">{r.role ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.start_date ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.end_date ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {imp.record_type === "document" && records.documents.length > 0 && (
        <Section title={`Documents (${records.documents.length})`}>
          <Table headers={["Person", "Type", "Identifier", "Expires", "File"]}>
            {records.documents.map((r: DocumentRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <PersonLink p={r.library_persons} />
                </td>
                <td className="px-3 py-2">{r.doc_type ?? "—"}</td>
                <td className="px-3 py-2">{r.identifier ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.expires_at ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {r.file_url ? (
                    <a
                      href={r.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-electric hover:underline"
                    >
                      Open
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Table({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="phone-stack min-w-full text-sm">
        <thead className="bg-muted/50 text-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{stampFieldLabels(headers, children)}</tbody>
      </table>
    </div>
  );
}

type FieldCell = { children?: ReactNode; "data-label"?: string };

/** Phone rows read `data-label`. Detail tables name each cell from its column. */
function stampFieldLabels(headers: string[], children: ReactNode) {
  return Children.map(children, (row) => {
    if (!isValidElement<FieldCell>(row)) return row;
    const cells = Children.map(row.props.children, (cell, i) => {
      if (!isValidElement<FieldCell>(cell)) return cell;
      const label = headers[i];
      if (!label || cell.props["data-label"]) return cell;
      return cloneElement(cell, { "data-label": label });
    });
    return cloneElement(row, undefined, cells);
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

function PersonLink({
  p,
}: {
  p: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name?: string | null;
    email: string | null;
    raw_data?: Record<string, unknown> | null;
  } | null;
}) {
  if (!p) return <span className="text-muted-foreground">—</span>;
  return (
    <Link
      href={`/records-library/persons/${p.id}`}
      className="text-foreground hover:underline"
    >
      {bestPersonName(p)}
    </Link>
  );
}

const RL_TONE: Record<string, Tone> = {
  completed: "good",
  processing: "warn",
  pending: "warn",
  failed: "bad",
};

function StatusBadge({ status }: { status: string }) {
  return <StatusPill tone={RL_TONE[status] ?? "quiet"}>{status}</StatusPill>;
}

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  linked_user_id: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
};

type PersonRef = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  raw_data: Record<string, unknown> | null;
} | null;

type ApplicationRow = {
  id: string;
  program_name: string | null;
  cohort: string | null;
  status: string | null;
  submitted_at: string | null;
  library_persons: PersonRef;
};

type PaymentRow = {
  id: string;
  amount: number | null;
  currency: string | null;
  description: string | null;
  paid_at: string | null;
  library_persons: PersonRef;
};

type EnrollmentRow = {
  id: string;
  school_name: string | null;
  program_name: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  library_persons: PersonRef;
};

type DocumentRow = {
  id: string;
  doc_type: string | null;
  identifier: string | null;
  expires_at: string | null;
  file_url: string | null;
  library_persons: PersonRef;
};
