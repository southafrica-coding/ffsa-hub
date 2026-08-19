import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserHistory } from "@/services/records-library";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Masthead } from "@/components/ffsa";

export default async function MyHistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const history = await getUserHistory(supabase, user.id);

  const isEmpty =
    history.applications.length === 0 &&
    history.payments.length === 0 &&
    history.enrollments.length === 0 &&
    history.documents.length === 0;

  return (
    <div className="ffsa-screen">
      <Masthead context="Personal" title="My History" />
      <div className="space-y-6 px-5 py-6 md:px-8">
          <p className="max-w-2xl text-sm text-[#55524A]">
            Records on file from past applications, payments, schools, and
            documents.
          </p>
        {isEmpty && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing on file yet. If you&apos;ve previously applied to FFSA,
                staff will link your history here.
              </p>
            </CardContent>
          </Card>
        )}

        {history.applications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Applications</CardTitle>
              <CardDescription>School and program applications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {history.applications.map((row: ApplicationRow) => (
                  <RecordRow
                    key={row.id}
                    title={row.program_name ?? "Application"}
                    subtitle={[row.cohort, row.status].filter(Boolean).join(" • ")}
                    dateLabel="Submitted"
                    date={row.submitted_at}
                    raw={row.raw_data}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {history.enrollments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Training attended</CardTitle>
              <CardDescription>Past enrollments and staff seasons</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {history.enrollments.map((row: EnrollmentRow) => (
                  <RecordRow
                    key={row.id}
                    title={row.school_name ?? row.program_name ?? "Enrollment"}
                    subtitle={[row.program_name, row.role].filter(Boolean).join(" • ")}
                    dateLabel="Dates"
                    date={
                      row.start_date && row.end_date
                        ? `${row.start_date} – ${row.end_date}`
                        : row.start_date ?? row.end_date
                    }
                    raw={row.raw_data}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {history.payments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>Historical payment records</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {history.payments.map((row: PaymentRow) => (
                  <RecordRow
                    key={row.id}
                    title={
                      row.amount != null
                        ? `${row.currency ?? ""} ${row.amount}`.trim()
                        : "Payment"
                    }
                    subtitle={row.description ?? undefined}
                    dateLabel="Paid"
                    date={row.paid_at}
                    raw={row.raw_data}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {history.documents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>
                Passport, insurance, certificates, etc.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {history.documents.map((row: DocumentRow) => (
                  <RecordRow
                    key={row.id}
                    title={row.doc_type ?? "Document"}
                    subtitle={row.identifier ?? undefined}
                    dateLabel="Expires"
                    date={row.expires_at}
                    raw={row.raw_data}
                    fileUrl={row.file_url}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function RecordRow({
  title,
  subtitle,
  dateLabel,
  date,
  raw,
  fileUrl,
}: {
  title: string;
  subtitle?: string;
  dateLabel: string;
  date?: string | null;
  raw?: Record<string, unknown> | null;
  fileUrl?: string | null;
}) {
  const rawEntries = raw && typeof raw === "object" ? Object.entries(raw) : [];
  return (
    <details className="border rounded-md p-3 group">
      <summary className="cursor-pointer flex items-start justify-between gap-3">
        <div className="space-y-0.5 flex-1">
          <div className="font-medium text-sm">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {date ? (
            <>
              <span className="block">{dateLabel}</span>
              <span className="block font-medium">{date}</span>
            </>
          ) : null}
        </div>
      </summary>
      <div className="mt-3 pt-3 border-t space-y-2">
        {fileUrl && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs underline text-blue-700"
          >
            Open file
          </a>
        )}
        {rawEntries.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Additional details
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {rawEntries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-medium text-muted-foreground truncate" title={k}>
                    {k}
                  </dt>
                  <dd className="break-words">
                    {v == null || v === ""
                      ? "—"
                      : typeof v === "object"
                      ? JSON.stringify(v)
                      : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </details>
  );
}

type ApplicationRow = {
  id: string;
  program_name: string | null;
  cohort: string | null;
  status: string | null;
  submitted_at: string | null;
  raw_data: Record<string, unknown> | null;
};

type EnrollmentRow = {
  id: string;
  school_name: string | null;
  program_name: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  raw_data: Record<string, unknown> | null;
};

type PaymentRow = {
  id: string;
  amount: number | null;
  currency: string | null;
  description: string | null;
  paid_at: string | null;
  raw_data: Record<string, unknown> | null;
};

type DocumentRow = {
  id: string;
  doc_type: string | null;
  file_url: string | null;
  identifier: string | null;
  expires_at: string | null;
  raw_data: Record<string, unknown> | null;
};
