// Pure helpers for the OKR screens (unit-tested in __tests__/logic.test.ts).
//
// The roll-ups themselves (counts, totals, progress ratios, who sees the
// "not started" list, who may check in) are worked out on the server with
// the website's own src/lib/okrs helpers; nothing here recomputes them.

import { ApiError } from "@/lib/api";

import { strings } from "./strings";
import { OKR_STATUSES, type OkrStatus, type StatusCounts } from "./types";

// ── Status words and tones ──────────────────────────────────────────────────

export type StatusTone = "default" | "positive" | "danger";

/**
 * Same mapping as the website's statusTone(): moving forward and complete
 * are good, stuck is bad, the rest are quiet. The word is always shown too,
 * so the colour never carries the meaning alone.
 */
export function statusTone(status: OkrStatus): StatusTone {
  if (status === "complete" || status === "moving_forward") return "positive";
  if (status === "stuck") return "danger";
  return "default";
}

export function statusLabel(status: OkrStatus): string {
  return strings.status[status] ?? status;
}

/** Non-zero counts in a fixed order, as "3 Complete" tags. */
export function statusTally(byStatus: StatusCounts): { status: OkrStatus; count: number; text: string }[] {
  return OKR_STATUSES.filter((st) => byStatus[st] > 0).map((st) => ({
    status: st,
    count: byStatus[st],
    text: `${byStatus[st]} ${statusLabel(st)}`,
  }));
}

export const STATUS_OPTIONS = OKR_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));

// ── Check-in input ──────────────────────────────────────────────────────────

export type CheckinBody = { status: OkrStatus; value: number | null; comment: string | null };

/**
 * Turn the form into the body POST /api/okrs/key-results/[id]/checkins
 * expects. The figure is only sent for a tracked key result, and accepts a
 * comma as the decimal mark (South African keyboards). Returns an error
 * sentence instead of letting the server answer 400.
 */
export function buildCheckin(input: {
  status: OkrStatus;
  value: string;
  comment: string;
  hasMetric: boolean;
}): { ok: true; body: CheckinBody } | { ok: false; error: string } {
  const comment = input.comment.trim() || null;
  const raw = input.value.trim().replace(/\s/g, "").replace(",", ".");
  if (!input.hasMetric || raw === "") return { ok: true, body: { status: input.status, value: null, comment } };
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return { ok: false, error: strings.errors.valueNotNumber };
  return { ok: true, body: { status: input.status, value: Number(raw), comment } };
}

// ── Errors in words ─────────────────────────────────────────────────────────

/** For a screen that failed to load. */
export function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "timeout") return strings.common.network;
    if (err.kind === "forbidden") return strings.common.forbidden;
  }
  return strings.common.generic;
}

/** For a check-in that didn't save. */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "timeout") return strings.errors.saveNetwork;
    if (err.kind === "forbidden") return strings.errors.saveForbidden;
  }
  return strings.errors.saveGeneric;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "http" && err.status === 404;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-01" → "1 Mar 2026". Anything else is returned unchanged. */
export function formatDay(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

// ── Navigation ──────────────────────────────────────────────────────────────

/** Website path for a cycle's wall or one group's page (for "open on the website"). */
export function webPath(ownerId: string | null, cycleSlug: string | null): string {
  const base = ownerId ? `/okrs/${ownerId}` : "/okrs";
  return cycleSlug ? `${base}?cycle=${encodeURIComponent(cycleSlug)}` : base;
}

/** Offline-copy names, per cycle (and group), so switching never shows the wrong cycle. */
export function cacheName(ownerId: string | null, cycleSlug: string | null): string {
  const cycle = cycleSlug ?? "current";
  return ownerId ? `okrs.owner.${ownerId}.${cycle}` : `okrs.wall.${cycle}`;
}
