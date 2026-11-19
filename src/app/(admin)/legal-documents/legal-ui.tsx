"use client";

// Small shared pieces for the Legal → Documents screens: data shapes, form
// fields, buttons and the fetch helper. Square, hairline, mono labels —
// the redesign's rules (CLAUDE.md "MOVEMENT, QUIET").

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { Tone } from "@/components/ffsa";
import type { ApplicationState, DocumentState } from "@/lib/legal/status";
import { URGENCY_COLOUR, URGENCY_LABEL, type Urgency } from "@/lib/legal/reminders";

// ────────────────────────────────────────────────────────────
// DATA SHAPES (what page.tsx passes down)
// ────────────────────────────────────────────────────────────

export type FolderRow = {
  id: string;
  name: string;
  kind: "organisation" | "personal" | "project";
  description: string | null;
  archived_at: string | null;
};

export type TypeRow = {
  id: string;
  key: string;
  name: string;
  category: "organisation" | "personal";
  issuer: string | null;
  lead_days: number;
  is_confirmed: boolean;
};

export type DocRow = {
  id: string;
  folder_id: string;
  type_id: string | null;
  title: string;
  holder: string | null;
  issuer: string | null;
  reference_no: string | null;
  issued_on: string | null;
  expires_on: string | null;
  renew_lead_days: number | null;
  status: string;
  superseded_by: string | null;
  notes: string | null;
};

export type FileRow = {
  id: string;
  folder_id: string;
  document_id: string | null;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  extraction_status: "none" | "pending" | "done" | "failed";
  /** The stored reading (see src/lib/legal/reading.ts StoredReading). */
  extracted_fields: { document_kind?: string; error?: string } & Record<string, unknown>;
};

export type StepRow = {
  id: string;
  position: number;
  label: string;
  due_on: string | null;
  done_at: string | null;
};

export type AppRow = {
  id: string;
  folder_id: string;
  document_id: string | null;
  title: string;
  status: string;
  lodge_by: string | null;
  submitted_on: string | null;
  expected_on: string | null;
  closed_on: string | null;
  reference_no: string | null;
  responsible_id: string | null;
  notes: string | null;
  steps: StepRow[];
};

export type Person = { id: string; name: string };

// ────────────────────────────────────────────────────────────
// WORDS AND TONES
// ────────────────────────────────────────────────────────────

export const FOLDER_KIND_LABEL: Record<FolderRow["kind"], string> = {
  organisation: "Organisation",
  personal: "Personal",
  project: "Project",
};

export const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  held: "Held",
  applying: "Applying",
  not_held: "Not held",
  superseded: "Replaced",
  cancelled: "Cancelled",
};

export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  gathering: "Gathering papers",
  submitted: "Submitted",
  waiting: "Waiting",
  approved: "Approved",
  refused: "Refused",
  withdrawn: "Withdrawn",
};

export const DOCUMENT_TONE: Record<DocumentState, Tone> = {
  expired: "bad",
  expiring: "warn",
  missing: "warn",
  in_hand: "quiet",
  valid: "good",
  no_expiry: "quiet",
  inactive: "quiet",
};

export const APPLICATION_TONE: Record<ApplicationState, Tone> = {
  late: "bad",
  overdue: "bad",
  due_soon: "warn",
  open: "quiet",
  waiting: "quiet",
  closed: "good",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-11-18 → "18 Nov 2026". Dates stay as calendar dates, no time zone. */
export function formatDate(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ────────────────────────────────────────────────────────────
// COLOUR SCALE — green 90 · yellow 60 · orange 30 · red 7 (reminders.ts)
// ────────────────────────────────────────────────────────────

/** Inline style for a row's coloured left edge; nothing beyond the scale. */
export function urgencyEdge(u: Urgency | null): React.CSSProperties | undefined {
  return u ? { boxShadow: `inset 4px 0 0 ${URGENCY_COLOUR[u].bg}` } : undefined;
}

/** A filled square chip on the scale, with optional words. */
export function UrgencyChip({ urgency, children }: { urgency: Urgency | null; children?: React.ReactNode }) {
  if (!urgency) return children ? <span className="font-mono text-[10px] tracking-[0.06em]">{children}</span> : null;
  const c = URGENCY_COLOUR[urgency];
  return (
    <span
      className="inline-flex items-center px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
      style={{ background: c.bg, color: c.fg }}
    >
      {children ?? URGENCY_LABEL[urgency]}
    </span>
  );
}

/** The four colours and what they mean, for the attention tab. */
export function UrgencyKey() {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {(Object.keys(URGENCY_COLOUR) as Urgency[]).map((u) => (
        <span key={u} className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-secondary)]">
          <span className="inline-block h-2.5 w-2.5" style={{ background: URGENCY_COLOUR[u].bg }} />
          {URGENCY_LABEL[u]}
        </span>
      ))}
    </span>
  );
}

// ────────────────────────────────────────────────────────────
// FETCH
// ────────────────────────────────────────────────────────────

/** JSON call to an /api/legal route; throws the server's message on failure. */
export async function callApi<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

// ────────────────────────────────────────────────────────────
// FORM PIECES
// ────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mono-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className={cn("mt-1 block text-[12px] text-[color:var(--text-tertiary)]", TEXT_RESET)}>{hint}</span>}
    </label>
  );
}

// The global `label` rule (globals.css) is mono, bold, uppercase and widely
// tracked; inputs sit inside their <label> and would inherit the tracking,
// weight and case. TEXT_RESET puts body text back.
export const TEXT_RESET = "font-sans font-normal normal-case tracking-normal";
export const inputClass = `block w-full min-h-11 min-w-0 ${TEXT_RESET}`;

export function TextInput({
  value,
  onChange,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
}) {
  return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
}

export function Select({
  value,
  onChange,
  children,
  ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {children}
    </select>
  );
}

export function TextArea({ value, onChange, rows = 3 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={`block w-full min-w-0 ${TEXT_RESET}`} />;
}

export function Button({
  children,
  onClick,
  tone = "solid",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "solid" | "outline" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] disabled:opacity-50",
        tone === "solid" && "border-ink bg-ink text-white hover:bg-[#262622]",
        tone === "outline" && "border-ink bg-white text-ink hover:bg-bone",
        tone === "danger" && "border-destructive bg-white text-destructive hover:bg-[#FBEDEC]"
      )}
    >
      {children}
    </button>
  );
}

/** A labelled block inside a drawer. */
export function DrawerSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-rule px-5 py-5 sm:px-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[15px] font-black uppercase tracking-[0.04em]">{title}</h3>
        {meta && <span className="mono-label">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="border-l-2 border-destructive bg-[#FBEDEC] px-3 py-2 text-[13px] text-destructive">
      {message}
    </p>
  );
}

// ────────────────────────────────────────────────────────────
// HISTORY (the event log for one row)
// ────────────────────────────────────────────────────────────

type HistoryEvent = { id: number; action: string; changed: string[]; at: string; who: string };

const FIELD_WORDS: Record<string, string> = {
  title: "title", holder: "holder", issuer: "issuer", reference_no: "reference number",
  issued_on: "issue date", expires_on: "expiry date", renew_lead_days: "lead time",
  status: "status", superseded_by: "replacement", notes: "notes", type_id: "type",
  folder_id: "folder", document_id: "document", lodge_by: "lodge-by date",
  submitted_on: "submitted date", expected_on: "expected date", closed_on: "closing date",
  responsible_id: "responsible person", name: "name", kind: "kind", description: "description",
  archived_at: "archive", extracted_fields: "read details", extracted_text: "read text",
  extraction_status: "reading", scanned_on: "scan date",
};

export function History({ table, id, version }: { table: string; id: string; version: number }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    callApi<{ events: HistoryEvent[] }>("GET", `/api/legal/history?table=${table}&id=${id}`)
      .then((r) => live && setEvents(r.events))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [table, id, version]);

  if (error) return <ErrorLine message={error} />;
  if (!events) return <p className="text-[13px] text-[color:var(--text-tertiary)]">Loading…</p>;
  if (events.length === 0) return <p className="text-[13px] text-[color:var(--text-tertiary)]">No changes yet.</p>;

  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const what =
          e.action === "insert"
            ? "added it"
            : e.action === "delete"
              ? "removed it"
              : `changed the ${e.changed.map((c) => FIELD_WORDS[c] ?? c.replace(/_/g, " ")).join(", ")}`;
        const when = new Date(e.at).toLocaleString("en-ZA", {
          timeZone: "Africa/Johannesburg",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        return (
          <li key={e.id} className="flex gap-3 text-[13px]">
            <span className="w-[92px] shrink-0 font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">{when}</span>
            <span>
              <strong className="font-semibold">{e.who}</strong> {what}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
