// Operations — the eight areas, item statuses and their words.
// docs/operations-plan.md. Order here is the order of the tabs.

export const AREAS = [
  { key: "maintenance", label: "Maintenance", live: true },
  { key: "transport", label: "Transportation", live: false },
  { key: "buildings", label: "Buildings & spaces", live: false },
  { key: "hospitality", label: "Hospitality", live: false },
  { key: "teams", label: "Visiting teams", live: true },
  { key: "events", label: "Events", live: false },
  { key: "equipment", label: "Equipment", live: false },
  { key: "innovations", label: "Innovations", live: false },
] as const;

export type AreaKey = (typeof AREAS)[number]["key"];
export const AREA_KEYS = AREAS.map((a) => a.key) as AreaKey[];
export const isAreaKey = (v: unknown): v is AreaKey =>
  typeof v === "string" && (AREA_KEYS as string[]).includes(v);
export const areaLabel = (key: string) => AREAS.find((a) => a.key === key)?.label ?? key;

export const STATUSES = ["new", "seen", "in_progress", "more_time", "done", "wont_do"] as const;
export type ItemStatus = (typeof STATUSES)[number];
export const isStatus = (v: unknown): v is ItemStatus =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isClosed = (s: string) => s === "done" || s === "wont_do";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  new: "New",
  seen: "Seen",
  in_progress: "In progress",
  more_time: "Needs more time",
  done: "Done",
  wont_do: "Won't do",
};

export const STATUS_TONE: Record<ItemStatus, "good" | "warn" | "quiet" | "bad"> = {
  new: "warn",
  seen: "quiet",
  in_progress: "quiet",
  more_time: "warn",
  done: "good",
  wont_do: "quiet",
};

/** Still open with no update for this many days → "gone quiet". */
export const QUIET_DAYS = 7;

export type OpsItem = {
  id: string;
  area: string;
  title: string;
  details: string | null;
  location: string | null;
  status: ItemStatus;
  owner_user_id: string | null;
  owner_name?: string | null;
  due_on: string | null;
  source: "slack" | "hub" | "meeting";
  requested_by_name: string | null;
  requested_by_slack_id: string | null;
  created_at: string;
  last_activity_at: string;
  closed_at: string | null;
  slack_channel?: string | null;
  slack_ts?: string | null;
  /** Maintenance requests from the Hub form (migration 405). */
  urgency?: string | null;
  photo_count?: number | null;
  out_of_hours?: boolean | null;
};
