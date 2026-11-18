import type { FollowUpStage, TimelineEntry, VisitType } from "./types";

export const STAGE_LABEL: Record<FollowUpStage, string> = {
  new: "New",
  contacted: "Contacted",
  visited_house: "Visited a house",
  joined: "Joined",
};

export const VISIT_LABEL: Record<VisitType, string> = {
  first_time: "First time",
  been_a_while: "Been a while",
  regular: "I'm a regular",
};

export const STAGES: FollowUpStage[] = ["new", "contacted", "visited_house", "joined"];

export function readStage(value: string | null | undefined): FollowUpStage {
  if (value === "contacted" || value === "visited_house" || value === "joined" || value === "new") return value;
  return "new";
}

export function formatWhen(value: string | null | undefined, withTime = false): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

export function newestFirst(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.slice().sort((a, b) => {
    const delta = Date.parse(b.at) - Date.parse(a.at);
    if (Number.isNaN(delta)) return 0;
    return delta;
  });
}

export function entryText(entry: TimelineEntry): string {
  if (entry.kind === "note") return entry.body?.trim() || "Note";
  if (entry.kind === "submitted") return "Sent a connect card";
  const from = entry.fromStage ? STAGE_LABEL[entry.fromStage] : "";
  const to = entry.toStage ? STAGE_LABEL[entry.toStage] : "";
  if (from && to) return `Moved from ${from} to ${to}`;
  if (to) return `Moved to ${to}`;
  return "Stage changed";
}

export function leaderMatches(leaderId: string | null, filter: string): boolean {
  if (!filter) return true;
  if (filter === "unassigned") return leaderId == null;
  return leaderId === filter;
}
