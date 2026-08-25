"use client";

import { useState, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CalendarCheck,
  Mail,
  FileText,
  Workflow,
  Target,
  Receipt,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  MailOpen,
  MousePointerClick,
  AlertTriangle,
  UserCog,
  GraduationCap,
} from "lucide-react";
import type {
  ContactDossier,
  DossierEmail,
  DossierForm,
} from "@/services/contact-dossier";

const GOLD = "#0A0A0A";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}
function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  return `${currency ?? "ZAR"} ${(cents / 100).toFixed(2)}`;
}

export function ContactDossier({ dossier }: { dossier: ContactDossier }) {
  const { counts } = dossier;
  const totalRecords =
    counts.events +
    counts.outcomes +
    counts.workflows +
    counts.emails +
    counts.calls +
    counts.forms +
    counts.orders +
    counts.schools;

  if (totalRecords === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engagement</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No events, forms, emails, workflows, calls or orders recorded for
            this contact yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Snapshot */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engagement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Stat n={counts.events} label="events" icon={<CalendarCheck className="h-3.5 w-3.5" />} />
            <Stat n={counts.outcomes} label="outcomes" icon={<Target className="h-3.5 w-3.5" />} />
            <Stat n={counts.workflows} label="workflows" icon={<Workflow className="h-3.5 w-3.5" />} />
            <Stat n={counts.emails} label="emails" icon={<Mail className="h-3.5 w-3.5" />} />
            <Stat n={counts.calls} label="calls" icon={<CalendarClock className="h-3.5 w-3.5" />} />
            <Stat n={counts.forms} label="forms" icon={<FileText className="h-3.5 w-3.5" />} />
            <Stat n={counts.schools} label="schools" icon={<GraduationCap className="h-3.5 w-3.5" />} />
            <Stat n={counts.orders} label="orders" icon={<Receipt className="h-3.5 w-3.5" />} />
          </div>
        </CardContent>
      </Card>

      {/* Events & attendance */}
      {dossier.events.length > 0 && (
        <Section title="Events & attendance" icon={<CalendarCheck className="h-4 w-4" />}>
          <div className="space-y-2">
            {dossier.events.map((e, i) => (
              <div key={e.eventId ?? i} className=" border bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{e.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{fmtDate(e.startDate)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {e.registrationStatus && (
                    <StatusPill label={`Registered: ${e.registrationStatus}`} tone={e.registrationStatus === "confirmed" ? "good" : "neutral"} />
                  )}
                  {e.attendanceStatus && (
                    <StatusPill label={`Attendance: ${e.attendanceStatus}`} tone={e.attendanceStatus === "present" ? "good" : e.attendanceStatus === "absent" ? "bad" : "neutral"} />
                  )}
                  {e.roles.map((r) => (
                    <StatusPill key={r} label={r} tone="accent" icon={<UserCog className="h-3 w-3" />} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Outcomes */}
      {dossier.outcomes.length > 0 && (
        <Section title="Outcomes" icon={<Target className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {dossier.outcomes.map((o, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{o.name}</span>
                  {o.eventTitle && (
                    <span className="text-xs text-muted-foreground"> · {o.eventTitle}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{fmtDate(o.respondedAt)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Workflows & follow-up */}
      {dossier.workflows.length > 0 && (
        <Section title="Workflows & follow-up" icon={<Workflow className="h-4 w-4" />}>
          <div className="space-y-2">
            {dossier.workflows.map((w) => (
              <div key={w.id} className=" border bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{w.name}</span>
                  <StatusPill
                    label={w.status}
                    tone={w.status === "active" ? "accent" : w.status === "completed" ? "good" : "neutral"}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {w.totalSteps > 0 ? `Step ${Math.min(w.currentStep + 1, w.totalSteps)} of ${w.totalSteps}` : "—"}
                  {w.currentStepType ? ` · next: ${w.currentStepType.replace(/_/g, " ")}` : ""}
                  {w.status === "active" && w.nextRunAt ? ` · runs ${fmtDate(w.nextRunAt)}` : ""}
                  {w.completedAt ? ` · completed ${fmtDate(w.completedAt)}` : ""}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Email history */}
      {dossier.emails.length > 0 && (
        <Section title="Email history" icon={<Mail className="h-4 w-4" />}>
          <EmailList emails={dossier.emails} />
        </Section>
      )}

      {/* Scheduled calls */}
      {dossier.calls.length > 0 && (
        <Section title="Scheduled calls" icon={<CalendarClock className="h-4 w-4" />}>
          <div className="space-y-2">
            {dossier.calls.map((c, i) => (
              <div key={i} className=" border bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill
                    label={c.status.replace(/_/g, " ")}
                    tone={c.status === "scheduled" ? "good" : c.status === "cancelled" ? "bad" : "neutral"}
                  />
                  <span className="text-xs text-muted-foreground">
                    {c.scheduledStart ? fmtDateTime(c.scheduledStart) : `requested ${fmtDate(c.createdAt)}`}
                  </span>
                </div>
                {c.durationMinutes && (
                  <p className="text-xs text-muted-foreground mt-1">{c.durationMinutes} min call</p>
                )}
                {c.message && <p className="text-xs mt-1 italic">“{c.message}”</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Forms submitted */}
      {dossier.forms.length > 0 && (
        <Section title="Forms submitted" icon={<FileText className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {dossier.forms.map((f) => (
              <FormRow key={f.id} form={f} />
            ))}
          </div>
        </Section>
      )}

      {/* Orders */}
      {dossier.orders.length > 0 && (
        <Section title="Orders & tickets" icon={<Receipt className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {dossier.orders.map((o, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{money(o.totalCents, o.currency)}</span>
                  {o.eventTitle && <span className="text-xs text-muted-foreground"> · {o.eventTitle}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill label={o.status} tone={o.status === "paid" ? "good" : o.status.includes("cancel") || o.status === "expired" ? "bad" : "neutral"} />
                  <span className="text-xs text-muted-foreground">{fmtDate(o.paidAt ?? o.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Schools — applications & enrollments */}
      {(dossier.applications.length > 0 || dossier.enrollments.length > 0) && (
        <Section title="Training" icon={<GraduationCap className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {dossier.applications.map((a, i) => (
              <div key={`app-${i}`} className="flex items-center justify-between gap-2 border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{a.programName}</span>
                  <span className="text-xs text-muted-foreground"> · application</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill
                    label={a.status}
                    tone={a.status === "accepted" ? "good" : a.status === "rejected" ? "bad" : a.status === "waitlisted" || a.status === "cancelled" ? "neutral" : "accent"}
                  />
                  <span className="text-xs text-muted-foreground">{fmtDate(a.submittedAt)}</span>
                </div>
              </div>
            ))}
            {dossier.enrollments.map((e, i) => (
              <div key={`enr-${i}`} className="flex items-center justify-between gap-2 border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{e.programName}</span>
                  <span className="text-xs text-muted-foreground"> · enrolled</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill
                    label={e.status.replace(/_/g, " ")}
                    tone={e.status === "active" ? "accent" : e.status === "completed" ? "good" : e.status === "withdrawn" ? "bad" : "neutral"}
                  />
                  <span className="text-xs text-muted-foreground">{fmtDate(e.completedAt ?? e.enrolledAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function EmailList({ emails }: { emails: DossierEmail[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? emails : emails.slice(0, 8);
  return (
    <div className="space-y-1.5">
      {shown.map((e, i) => (
        <div key={i} className="flex items-center justify-between gap-2 border bg-muted/20 px-3 py-2">
          <span className="text-sm truncate">{e.label}</span>
          <div className="flex items-center gap-2 shrink-0">
            {e.bouncedAt ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-destructive" title="Bounced">
                <AlertTriangle className="h-3 w-3" /> bounced
              </span>
            ) : (
              <>
                {e.clickedAt && <MousePointerClick className="h-3.5 w-3.5" style={{ color: GOLD }} aria-label="clicked" />}
                {e.openedAt && <MailOpen className="h-3.5 w-3.5 text-muted-foreground" aria-label="opened" />}
              </>
            )}
            <span className="text-xs text-muted-foreground">{fmtDate(e.sentAt)}</span>
          </div>
        </div>
      ))}
      {emails.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showAll ? "Show fewer" : `Show all ${emails.length}`}
        </button>
      )}
    </div>
  );
}

function FormRow({ form }: { form: DossierForm }) {
  const [open, setOpen] = useState(false);
  return (
    <div className=" border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="text-sm font-medium truncate">{form.formName}</span>
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{fmtDate(form.submittedAt)}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0 space-y-1">
          {form.answers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No answers recorded.</p>
          ) : (
            form.answers.map((a, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 text-xs">
                <span className="text-muted-foreground capitalize col-span-1 truncate">{a.key}</span>
                <span className="col-span-2 break-words">{a.value}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span style={{ color: GOLD }}>{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Stat({ n, label, icon }: { n: number; label: string; icon: ReactNode }) {
  const active = n > 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-sm"
      style={{
        borderColor: active ? GOLD : undefined,
        background: active ? "var(--yellow-dim)" : undefined,
        color: active ? undefined : "#45423B",
      }}
    >
      <span style={{ color: active ? GOLD : "inherit" }}>{icon}</span>
      <span className="tabular-nums font-semibold">{n}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function StatusPill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: "good" | "bad" | "neutral" | "accent";
  icon?: ReactNode;
}) {
  const styles: Record<string, string> = {
    good: "bg-grass/15 text-grass-text",
    bad: "bg-white text-destructive",
    neutral: "bg-muted text-muted-foreground",
    accent: "",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 capitalize ${styles[tone]}`}
      style={tone === "accent" ? { background: "var(--yellow-dim)", color: GOLD } : undefined}
    >
      {icon}
      {label}
    </span>
  );
}
