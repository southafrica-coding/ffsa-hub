import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserHistory } from "@/services/records-library";
import { Masthead, SectionBar } from "@/components/ffsa";

export default async function MyHistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const history = await getUserHistory(supabase, user.id);

  const total =
    history.applications.length +
    history.payments.length +
    history.enrollments.length +
    history.documents.length;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Personal · ${total} ${total === 1 ? "record" : "records"} on file`}
        title="My history"
      />

      <p className="border-b border-rule px-5 py-4 text-[14px] text-[color:var(--text-secondary)] md:px-8">
        Records on file from past applications, payments, schools and documents.
      </p>

      {total === 0 && (
        <div className="px-5 py-12 text-center md:px-8">
          <p className="mono-label">
            Nothing on file yet — if you have applied to FFSA before, staff will
            link your history here
          </p>
        </div>
      )}

      {history.applications.length > 0 && (
        <section>
          <SectionBar
            title="Applications"
            meta={`${history.applications.length}`}
          />
          <ul>
            {history.applications.map((row: ApplicationRow) => (
              <RecordRow
                key={row.id}
                title={row.program_name ?? "Application"}
                subtitle={[row.cohort, row.status].filter(Boolean).join(" · ")}
                dateLabel="Submitted"
                date={row.submitted_at}
                raw={row.raw_data}
              />
            ))}
          </ul>
        </section>
      )}

      {history.enrollments.length > 0 && (
        <section>
          <SectionBar
            title="Training attended"
            meta={`${history.enrollments.length}`}
          />
          <ul>
            {history.enrollments.map((row: EnrollmentRow) => (
              <RecordRow
                key={row.id}
                title={row.school_name ?? row.program_name ?? "Enrollment"}
                subtitle={[row.program_name, row.role].filter(Boolean).join(" · ")}
                dateLabel="Dates"
                date={
                  row.start_date && row.end_date
                    ? `${row.start_date} – ${row.end_date}`
                    : row.start_date ?? row.end_date
                }
                raw={row.raw_data}
              />
            ))}
          </ul>
        </section>
      )}

      {history.payments.length > 0 && (
        <section>
          <SectionBar title="Payments" meta={`${history.payments.length}`} />
          <ul>
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
          </ul>
        </section>
      )}

      {history.documents.length > 0 && (
        <section>
          <SectionBar title="Documents" meta={`${history.documents.length}`} />
          <ul>
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
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Two lines closed, the detail on demand. The frame's rule is that a list row
 * never runs to three lines — so the raw import payload, which can be twenty
 * fields wide, lives behind the disclosure rather than under the title.
 */
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
    <li className="border-b border-rule">
      <details className="group">
        <summary className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 px-5 py-3.5 hover:bg-[#F7F5EE] md:px-8">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-ink">{title}</div>
            {subtitle && <div className="mono-label mt-1 truncate">{subtitle}</div>}
          </div>
          {date && (
            <div className="shrink-0 text-right">
              <div className="mono-label">{dateLabel}</div>
              <div className="mt-0.5 font-mono text-[12px] font-bold text-ink">
                {date}
              </div>
            </div>
          )}
        </summary>

        <div className="space-y-3 border-t border-rule bg-bone px-5 py-4 md:px-8">
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-electric underline"
            >
              Open file
            </a>
          )}
          {rawEntries.length > 0 && (
            <div>
              <p className="mono-label mb-2">Additional details</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
                {rawEntries.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt
                      className="truncate font-semibold text-[color:var(--text-tertiary)]"
                      title={k}
                    >
                      {k}
                    </dt>
                    <dd className="break-words text-ink">
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
    </li>
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
