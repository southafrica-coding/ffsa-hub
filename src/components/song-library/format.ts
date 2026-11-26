import { stageMoveOptions, type StageMover } from "./stages";
import type { SongStage } from "./types";

const TZ = "Africa/Johannesburg";

/** "TUE 24 NOV", in South African time. */
export function eventDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`.toUpperCase().replace(/\./g, "");
}

/** "2 Nov", in South African time. */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, day: "numeric", month: "short" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}`.replace(/\./g, "");
}

/** "today", "yesterday", "2 days ago", "2 weeks ago", "last month". */
export function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  return `${Math.floor(days / 30)} months ago`;
}

/** The small line under a song row. */
export function activityLine(opts: { days: number; stuck: boolean; stage: SongStage; uploaded: boolean }): string {
  if (opts.stuck) return `No change in ${opts.days} days`;
  if (opts.uploaded) return `Uploaded ${ago(opts.days)}`;
  if (opts.stage === "set_down") return `Set down ${ago(opts.days)}`;
  return `Moved ${ago(opts.days)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function duration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function moverFor(isManager: boolean, isWriter: boolean): StageMover {
  if (isManager) return "manager";
  if (isWriter) return "writer";
  return "none";
}

export function hasStageMoves(mover: StageMover, stage: SongStage): boolean {
  return stageMoveOptions(mover, stage).length > 0;
}
