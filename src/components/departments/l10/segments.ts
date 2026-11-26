import { L10_SEGMENTS, type L10Segment } from "./types";

export interface SegmentInfo {
  key: L10Segment;
  /** Segment heading and full label. */
  label: string;
  /** Label for the tight seven-up rail. */
  short: string;
  minutes: number;
}

export const SEGMENT_INFO: Record<L10Segment, SegmentInfo> = {
  segue: { key: "segue", label: "Segue", short: "Segue", minutes: 5 },
  scorecard: { key: "scorecard", label: "Scorecard", short: "Score", minutes: 5 },
  rock_review: { key: "rock_review", label: "Rocks", short: "Rocks", minutes: 5 },
  headlines: { key: "headlines", label: "Headlines", short: "Headl.", minutes: 5 },
  todo_list: { key: "todo_list", label: "To-dos", short: "To-dos", minutes: 5 },
  ids: { key: "ids", label: "IDS", short: "IDS", minutes: 60 },
  conclude: { key: "conclude", label: "Conclude", short: "Concl.", minutes: 5 },
};

export const SEGMENTS: readonly SegmentInfo[] = L10_SEGMENTS.map((key) => SEGMENT_INFO[key]);

export const MEETING_MINUTES = SEGMENTS.reduce((sum, segment) => sum + segment.minutes, 0);

export function isSegment(value: unknown): value is L10Segment {
  return typeof value === "string" && (L10_SEGMENTS as readonly string[]).includes(value);
}

/** The segment after `key`, or null after Conclude. */
export function nextSegment(key: L10Segment): L10Segment | null {
  const index = L10_SEGMENTS.indexOf(key);
  return L10_SEGMENTS[index + 1] ?? null;
}

export function segmentIndex(key: L10Segment): number {
  return L10_SEGMENTS.indexOf(key);
}
