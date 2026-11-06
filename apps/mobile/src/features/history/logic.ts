// Pure helpers for My History (unit-tested in __tests__/logic.test.ts): turn
// the four record lists into the sections and rows the website's /my-history
// page shows, with the same titles, subtitles and fallbacks.

import { strings } from "./strings";
import type { History } from "./types";

export type Kind = "applications" | "enrollments" | "payments" | "documents";

/** One row on the list, plus what its detail sheet shows. */
export type HistoryRecord = {
  key: string;
  kind: Kind;
  title: string;
  subtitle: string | null;
  dateLabel: string;
  date: string | null;
  /** A link that's safe to open (website path or http(s) URL), else null. */
  fileUrl: string | null;
  /** The raw import payload, in its own order, values as text. */
  details: { label: string; value: string }[];
};

export type Section = { kind: Kind; title: string; records: HistoryRecord[] };

// The web's order: Applications, Training attended, Payments, Documents.
const ORDER: Kind[] = ["applications", "enrollments", "payments", "documents"];

export function totalRecords(h: History): number {
  return h.applications.length + h.enrollments.length + h.payments.length + h.documents.length;
}

/** Sections with at least one record, in the web's order. */
export function toSections(h: History): Section[] {
  const records: Record<Kind, HistoryRecord[]> = {
    applications: h.applications.map((r) => ({
      key: `applications-${r.id}`,
      kind: "applications" as const,
      title: r.program_name ?? strings.fallback.application,
      subtitle: joinParts([r.cohort, r.status]),
      dateLabel: strings.dateLabel.applications,
      date: formatDate(r.submitted_at),
      fileUrl: null,
      details: detailEntries(r.raw_data),
    })),
    enrollments: h.enrollments.map((r) => ({
      key: `enrollments-${r.id}`,
      kind: "enrollments" as const,
      title: r.school_name ?? r.program_name ?? strings.fallback.enrollment,
      subtitle: joinParts([r.program_name, r.role]),
      dateLabel: strings.dateLabel.enrollments,
      date: formatRange(r.start_date, r.end_date),
      fileUrl: null,
      details: detailEntries(r.raw_data),
    })),
    payments: h.payments.map((r) => ({
      key: `payments-${r.id}`,
      kind: "payments" as const,
      title: formatAmount(r.amount, r.currency) ?? strings.fallback.payment,
      subtitle: r.description,
      dateLabel: strings.dateLabel.payments,
      date: formatDate(r.paid_at),
      fileUrl: null,
      details: detailEntries(r.raw_data),
    })),
    documents: h.documents.map((r) => ({
      key: `documents-${r.id}`,
      kind: "documents" as const,
      title: r.doc_type ?? strings.fallback.document,
      subtitle: r.identifier,
      dateLabel: strings.dateLabel.documents,
      date: formatDate(r.expires_at),
      fileUrl: safeFileUrl(r.file_url),
      details: detailEntries(r.raw_data),
    })),
  };
  return ORDER.filter((k) => records[k].length > 0).map((k) => ({ kind: k, title: strings.sections[k], records: records[k] }));
}

/** What a screen reader says for a row: title, subtitle, then the date with its label. */
export function recordA11yLabel(r: HistoryRecord): string {
  return [r.title, r.subtitle, r.date ? `${r.dateLabel} ${r.date}` : null].filter(Boolean).join(". ");
}

// ── Formatting ──────────────────────────────────────────────────────────────

function joinParts(parts: (string | null)[]): string | null {
  const s = parts.filter((p): p is string => !!p && p.trim() !== "").join(" · ");
  return s === "" ? null : s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2019-03-12" or "2019-03-12T08:00:00+00:00" -> "12 Mar 2019". Unreadable text passes through. */
export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return value;
  return `${d} ${MONTHS[mo - 1]} ${y}`;
}

/** "12 Jan 2019 – 4 Apr 2019", or whichever end is known, or null. */
export function formatRange(start: string | null, end: string | null): string | null {
  const a = formatDate(start);
  const b = formatDate(end);
  if (a && b) return `${a} – ${b}`;
  return a ?? b;
}

/** "ZAR 1,500.00"; currency is free text in old imports, so it's shown as given. */
export function formatAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const n = `${amount < 0 ? "-" : ""}${grouped}.${cents}`;
  return currency?.trim() ? `${currency.trim()} ${n}` : n;
}

/** The raw payload as label/value text, like the web's "Additional details". */
export function detailEntries(raw: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(raw).map(([label, v]) => ({
    label,
    value: v === null || v === undefined || v === "" ? strings.detail.empty : typeof v === "object" ? JSON.stringify(v) : String(v),
  }));
}

/**
 * Only website paths and http(s) URLs are opened (in the in-app browser).
 * Anything else (another scheme, a protocol-relative "//host") is not offered.
 */
export function safeFileUrl(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^https?:\/\/[^\s]+$/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return null;
}
