import Link from "next/link";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getPerson, getRecordsForPerson } from "@/services/records-library";
import { CsvSheet } from "@/components/csv-sheet";
import { bestPersonName } from "@/lib/person-name";

export default async function PersonDetailPage({
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

  const { data: person } = await getPerson(supabase, id);
  if (!person) notFound();

  const records = await getRecordsForPerson(supabase, id);

  const fullName = bestPersonName(person);

  const linkedUser = person.users;
  const linkedUserName = linkedUser
    ? [linkedUser.first_name, linkedUser.last_name].filter(Boolean).join(" ") ||
      linkedUser.email
    : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">{fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {person.email ?? "no email"}
            {person.date_of_birth ? ` · DOB ${person.date_of_birth}` : ""}
            {person.phone ? ` · ${person.phone}` : ""}
          </p>
        </div>
        <Link
          href={`/print/records-library/persons/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-muted shrink-0"
        >
          <Printer className="h-4 w-4" />
          Print / Save as PDF
        </Link>
      </div>

      <div className="border rounded-md p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
          Linked user
        </div>
        {linkedUserName ? (
          <div className="text-sm">
            <span className="font-medium">{linkedUserName}</span>
            {linkedUser?.email && linkedUser.email !== linkedUserName ? (
              <span className="text-muted-foreground"> · {linkedUser.email}</span>
            ) : null}
            <div className="text-xs text-muted-foreground mt-1">
              Linked via {person.link_method ?? "—"}
              {person.linked_at
                ? ` on ${new Date(person.linked_at).toLocaleString()}`
                : ""}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not linked to a user account yet — matching engine will attach this
            record automatically when a matching user signs up.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Applications" value={records.applications.length} />
        <Stat label="Payments" value={records.payments.length} />
        <Stat label="Enrollments" value={records.enrollments.length} />
        <Stat label="Documents" value={records.documents.length} />
      </div>

      {records.applications.length > 0 && (
        <Section title="Applications">
          <Table headers={["Program", "Cohort", "Status", "Submitted", "Source"]}>
            {records.applications.map((r: ApplicationRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.program_name ?? "—"}</td>
                <td className="px-3 py-2">{r.cohort ?? "—"}</td>
                <td className="px-3 py-2">{r.status ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.submitted_at
                    ? new Date(r.submitted_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <ImportLink imp={r.library_imports} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {records.payments.length > 0 && (
        <Section title="Payments">
          <Table headers={["Amount", "Currency", "Description", "Paid", "Source"]}>
            {records.payments.map((r: PaymentRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-right">
                  {r.amount?.toLocaleString() ?? "—"}
                </td>
                <td className="px-3 py-2">{r.currency ?? "—"}</td>
                <td className="px-3 py-2">{r.description ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.paid_at ?? "—"}</td>
                <td className="px-3 py-2">
                  <ImportLink imp={r.library_imports} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {records.enrollments.length > 0 && (
        <Section title="Enrollments">
          <Table headers={["School", "Program", "Role", "Start", "End", "Source"]}>
            {records.enrollments.map((r: EnrollmentRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.school_name ?? "—"}</td>
                <td className="px-3 py-2">{r.program_name ?? "—"}</td>
                <td className="px-3 py-2">{r.role ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.start_date ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.end_date ?? "—"}</td>
                <td className="px-3 py-2">
                  <ImportLink imp={r.library_imports} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {records.documents.length > 0 && (
        <Section title="Documents">
          <Table headers={["Type", "Identifier", "Expires", "File", "Source"]}>
            {records.documents.map((r: DocumentRow) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.doc_type ?? "—"}</td>
                <td className="px-3 py-2">{r.identifier ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.expires_at ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.file_url ? (
                    <a
                      href={r.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      Open
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <ImportLink imp={r.library_imports} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {records.applications.length === 0 &&
        records.payments.length === 0 &&
        records.enrollments.length === 0 &&
        records.documents.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            No records attached to this person yet.
          </p>
        )}

      {Object.keys(person.raw_data ?? {}).length > 0 && (
        <Section title="Form responses">
          <CsvSheet
            raw={person.raw_data}
            columnOrder={person.source_import?.column_order ?? null}
          />
        </Section>
      )}
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
      <table className="min-w-full text-sm">
        <thead className="bg-muted/50 text-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
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

function ImportLink({
  imp,
}: {
  imp: { filename: string | null } | null;
}) {
  if (!imp?.filename) return <span className="text-muted-foreground">—</span>;
  return <span className="text-muted-foreground">{imp.filename}</span>;
}

type ImportRef = { filename: string | null; created_at: string | null } | null;

type ApplicationRow = {
  id: string;
  program_name: string | null;
  cohort: string | null;
  status: string | null;
  submitted_at: string | null;
  library_imports: ImportRef;
};

type PaymentRow = {
  id: string;
  amount: number | null;
  currency: string | null;
  description: string | null;
  paid_at: string | null;
  library_imports: ImportRef;
};

type EnrollmentRow = {
  id: string;
  school_name: string | null;
  program_name: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  library_imports: ImportRef;
};

type DocumentRow = {
  id: string;
  doc_type: string | null;
  identifier: string | null;
  expires_at: string | null;
  file_url: string | null;
  library_imports: ImportRef;
};
