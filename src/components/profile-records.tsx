import Link from "next/link";
import {
  Printer,
  FileText,
  GraduationCap,
  Receipt,
  FileBadge,
  Ticket,
  UserCheck,
  ShieldCheck,
  Flame,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getProfileAttachments,
  type AttachmentRow,
} from "@/services/profile-attachments";
import { bestPersonName } from "@/lib/person-name";

/**
 * Shared records-on-file panel for both the admin user profile (/users/[id])
 * and the personal profile (/profile). Reads via the service-role admin
 * client so staff can see another user's records — RLS only lets users
 * read their own linked rows.
 *
 * Combines historical CSV rows (library_*) with everything created in-app:
 * application_responses, enrollments, student_payments, orders/tickets,
 * reference_requests, consent_records, prayer_room_slot_members.
 *
 * `canOpenLibrary` controls whether the linked-source-records list shows
 * "Open record" / "Print sheet" deep-links to the records-library. Self-view
 * sets this false; the admin view sets it from the viewer's Records Library
 * access.
 *
 * `showLibrarySources` controls whether the linked CSV rows are listed at all.
 * It defaults to true for the self-view — that is the user's own data. The
 * admin view passes the viewer's Records Library access, because a general
 * `admin` is carved out of that module (see SUPER_ADMIN_ONLY_MODULES) and this
 * component reads library_persons with the service-role client, so RLS does
 * not gate it here.
 */
export async function ProfileRecords({
  userId,
  canOpenLibrary,
  showLibrarySources = true,
}: {
  userId: string;
  canOpenLibrary: boolean;
  showLibrarySources?: boolean;
}) {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  const [linkedPersonsRes, attachments] = await Promise.all([
    adminAny
      .from("library_persons")
      .select(
        "id, first_name, last_name, preferred_name, email, date_of_birth, link_method, linked_at, source_import_id, raw_data"
      )
      .eq("linked_user_id", userId)
      .order("linked_at", { ascending: false }),
    getProfileAttachments(admin, userId),
  ]);
  const linkedPersons: LinkedPerson[] = showLibrarySources
    ? (linkedPersonsRes.data ?? [])
    : [];

  const total =
    attachments.applications.length +
    attachments.enrollments.length +
    attachments.payments.length +
    attachments.tickets.length +
    attachments.documents.length +
    attachments.references.length +
    attachments.consents.length +
    attachments.prayerRoom.length;

  if (linkedPersons.length === 0 && total === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {canOpenLibrary
            ? "Nothing on file yet. Records will appear here as the user submits applications, makes payments, attends events, etc., or when staff upload historical CSVs."
            : "Nothing on file yet. Applications, payments, tickets and other records you create in FFSA Hub will appear here automatically."}
        </p>
        {canOpenLibrary && (
          <Link
            href="/records-library"
            className="inline-block mt-3 text-xs underline text-muted-foreground hover:text-foreground"
          >
            Go to Records Library →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <BigStat
          label="Applications"
          value={tileCount(attachments.applications)}
          icon={FileText}
          tint="blue"
        />
        <BigStat
          label="Enrollments"
          value={tileCount(attachments.enrollments)}
          icon={GraduationCap}
          tint="emerald"
        />
        <BigStat
          label="Payments"
          value={tileCount(attachments.payments)}
          icon={Receipt}
          tint="amber"
        />
        <BigStat
          label="Tickets"
          value={tileCount(attachments.tickets)}
          icon={Ticket}
          tint="violet"
        />
      </div>

      {/* Tiles show the real on-file count: in-app multiples (e.g. 16 tickets)
          count in full; CSV re-imports count once. The Sections below show
          "distinct / total" (e.g. 3 / 16) when identical rows were collapsed. */}

      {linkedPersons.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          <div className="bg-muted/50 px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Linked CSV source record{linkedPersons.length === 1 ? "" : "s"}
          </div>
          <div className="divide-y">
            {linkedPersons.map((lp) => {
              const name = bestPersonName(lp);
              return (
                <div
                  key={lp.id}
                  className="flex flex-wrap items-center gap-3 justify-between px-4 py-3 text-sm"
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="font-medium truncate">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      {lp.email ?? "no email"}
                      {lp.date_of_birth ? ` · DOB ${lp.date_of_birth}` : ""}
                      {lp.link_method ? ` · linked via ${lp.link_method}` : ""}
                    </div>
                  </div>
                  {canOpenLibrary && (
                    <div className="flex gap-2 shrink-0">
                      <Link
                        href={`/records-library/persons/${lp.id}`}
                        className="px-2.5 py-1 text-xs border rounded-md hover:bg-muted"
                      >
                        Open record
                      </Link>
                      <Link
                        href={`/print/records-library/persons/${lp.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-md hover:bg-muted"
                      >
                        <Printer className="h-3 w-3" />
                        Print
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Applications"
          empty="No applications on file."
          rows={attachments.applications}
          icon={FileText}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Enrollments"
          empty="No enrollments on file."
          rows={attachments.enrollments}
          icon={GraduationCap}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Payments"
          empty="No payments on file."
          rows={attachments.payments}
          icon={Receipt}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Event tickets"
          empty="No event tickets on file."
          rows={attachments.tickets}
          icon={Ticket}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Documents"
          empty="No documents on file."
          rows={attachments.documents}
          icon={FileBadge}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="References"
          empty="No references requested or submitted."
          rows={attachments.references}
          icon={UserCheck}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Consents"
          empty="No agreements accepted yet."
          rows={attachments.consents}
          icon={ShieldCheck}
        />
        <Section
          canOpenLibrary={canOpenLibrary}
          title="Prayer room"
          empty="No prayer-room slots signed up to."
          rows={attachments.prayerRoom}
          icon={Flame}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  rows,
  icon: Icon,
  canOpenLibrary,
}: {
  title: string;
  empty: string;
  rows: AttachmentRow[];
  icon: React.ComponentType<{ className?: string }>;
  canOpenLibrary: boolean;
}) {
  // Distinct rows count (after CSV dedup) shown in the header; the total
  // underlying record count (sum of `count` for collapsed groups) renders
  // beside it so staff don't lose visibility of the raw number on file.
  const distinctCount = rows.length;
  const underlyingTotal = rows.reduce((sum, r) => sum + (r.count ?? 1), 0);
  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {title}
          </span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {distinctCount}
          {underlyingTotal > distinctCount && (
            <span className="opacity-60"> / {underlyingTotal}</span>
          )}
        </span>
      </div>
      <div className="px-4 py-1">
        {rows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground italic">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="border-t first:border-t-0">
                <Row r={r} canOpenLibrary={canOpenLibrary} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({
  r,
  canOpenLibrary,
}: {
  r: AttachmentRow;
  canOpenLibrary: boolean;
}) {
  const body = (
    <div className="flex items-start justify-between gap-2 py-2.5 px-1 -mx-1 rounded-md">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
          <span className="capitalize">{r.title}</span>
          <SourceBadge source={r.source} />
          {r.count && r.count > 1 && (
            <span
              className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-muted text-muted-foreground"
              title={`${r.count} identical records combined into one row`}
            >
              ×{r.count}
            </span>
          )}
        </div>
        {r.subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {r.subtitle}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground shrink-0 text-right">
        {r.date ? (
          <>
            {r.dateLabel && (
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                {r.dateLabel}
              </div>
            )}
            <div>{formatDate(r.date)}</div>
          </>
        ) : null}
      </div>
    </div>
  );

  // CSV rows deep-link to the library_person record — but only for a viewer
  // who can actually open the Records Library. In-app rows stay un-linked
  // here (each in-app domain has its own detail page; we keep the routing
  // decision out of this shared component for now).
  if (canOpenLibrary && r.source === "csv" && r.libraryPersonId) {
    return (
      <Link
        href={`/records-library/persons/${r.libraryPersonId}`}
        className="block hover:bg-muted/40 rounded-md transition-colors"
      >
        {body}
        {r.fileUrl && (
          <div className="px-1 pb-2 -mt-1">
            <a
              href={r.fileUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs underline text-blue-400"
            >
              Open file →
            </a>
          </div>
        )}
      </Link>
    );
  }

  return (
    <>
      {body}
      {r.fileUrl && (
        <div className="px-1 pb-2 -mt-1">
          <a
            href={r.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline text-blue-400"
          >
            Open file →
          </a>
        </div>
      )}
    </>
  );
}

function SourceBadge({ source }: { source: "csv" | "app" }) {
  const isCsv = source === "csv";
  return (
    <span
      className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
        isCsv
          ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
          : "bg-blue-500/10 text-blue-300 border-blue-500/30"
      }`}
      title={isCsv ? "Imported from CSV upload" : "Created in-app"}
    >
      {isCsv ? "Imported" : "In-app"}
    </span>
  );
}

function formatDate(iso: string): string {
  // Cheap human format. Times of day collapse to date only.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

function tileCount(rows: AttachmentRow[]): number {
  // In-app multiples count in full (16 tickets → 16); CSV rows count once
  // each, since a CSV re-imported N times is still one real record.
  return rows.reduce(
    (sum, r) => sum + (r.source === "csv" ? 1 : (r.count ?? 1)),
    0
  );
}

function BigStat({
  label,
  value,
  icon: Icon,
  tint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tint: "blue" | "emerald" | "amber" | "violet";
}) {
  const tints = {
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-300",
    emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    violet: "bg-violet-500/10 border-violet-500/30 text-violet-300",
  } as const;
  return (
    <div className={`rounded-xl border p-4 ${tints[tint]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="text-3xl font-bold tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

type LinkedPerson = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  link_method: string | null;
  linked_at: string | null;
  source_import_id: string | null;
  raw_data: Record<string, unknown> | null;
};
