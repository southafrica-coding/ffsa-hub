// The meeting clock. Pure: every function takes `now` (epoch ms), so a
// backgrounded tab that misses ticks still reads the right time on the next
// render. Pause and +1 min are local; only segment moves go to the server.

import { L10_SEGMENTS, type L10Meeting, type L10Segment } from "./types";
import { SEGMENT_INFO, nextSegment } from "./segments";

const MINUTE = 60_000;

export interface TimerState {
  segment: L10Segment;
  meetingStartedAt: number;
  segmentStartedAt: number;
  /** +1 min presses, per segment. */
  extraMs: Partial<Record<L10Segment, number>>;
  /** Closed pauses in the current segment. */
  segmentPausedMs: number;
  /** Closed pauses across the meeting. */
  meetingPausedMs: number;
  /** Set while paused. */
  pausedAt: number | null;
  /** Elapsed time of finished segments. */
  finished: Partial<Record<L10Segment, number>>;
}

export type SegmentState = "done" | "done-over" | "current" | "current-over" | "upcoming";

export function createTimer(options: {
  meetingStartedAt: number;
  segment?: L10Segment;
  segmentStartedAt?: number;
  finished?: Partial<Record<L10Segment, number>>;
}): TimerState {
  return {
    segment: options.segment ?? "segue",
    meetingStartedAt: options.meetingStartedAt,
    segmentStartedAt: options.segmentStartedAt ?? options.meetingStartedAt,
    extraMs: {},
    segmentPausedMs: 0,
    meetingPausedMs: 0,
    pausedAt: null,
    finished: options.finished ?? {},
  };
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Rebuild the clock from the server's segment_timings. The current segment
 * is the last one that has started; earlier segments with both ends count as
 * finished. A meeting with no timings is in Segue from started_at.
 */
export function timerFromMeeting(
  meeting: Pick<L10Meeting, "started_at" | "segment_timings" | "current_segment">
): TimerState {
  const meetingStartedAt = ms(meeting.started_at) ?? 0;
  let segment: L10Segment = "segue";
  let segmentStartedAt = meetingStartedAt;
  const finished: Partial<Record<L10Segment, number>> = {};
  const timings = meeting.segment_timings ?? {};
  for (const key of L10_SEGMENTS) {
    const timing = timings[key];
    const start = ms(timing?.started_at);
    if (start == null) continue;
    segment = key;
    segmentStartedAt = start;
    const end = ms(timing?.ended_at);
    if (end != null) finished[key] = Math.max(0, end - start);
  }
  // #741 sends current_segment on every meeting; the rail and timer follow it.
  const current = meeting.current_segment;
  if (current && (L10_SEGMENTS as readonly string[]).includes(current)) {
    const start = ms(timings[current]?.started_at);
    if (start != null) segmentStartedAt = start;
    segment = current;
  }
  delete finished[segment];
  return createTimer({ meetingStartedAt, segment, segmentStartedAt, finished });
}

export function allowanceMs(state: TimerState, key: L10Segment = state.segment): number {
  return SEGMENT_INFO[key].minutes * MINUTE + (state.extraMs[key] ?? 0);
}

function clockNow(state: TimerState, now: number): number {
  return state.pausedAt ?? now;
}

export function segmentElapsedMs(state: TimerState, now: number): number {
  return Math.max(0, clockNow(state, now) - state.segmentStartedAt - state.segmentPausedMs);
}

export function meetingElapsedMs(state: TimerState, now: number): number {
  return Math.max(0, clockNow(state, now) - state.meetingStartedAt - state.meetingPausedMs);
}

/** Negative once the segment runs over. */
export function remainingMs(state: TimerState, now: number): number {
  return allowanceMs(state) - segmentElapsedMs(state, now);
}

export function isOverTime(state: TimerState, now: number): boolean {
  return segmentElapsedMs(state, now) > allowanceMs(state);
}

export function isPaused(state: TimerState): boolean {
  return state.pausedAt != null;
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.pausedAt != null) return state;
  return { ...state, pausedAt: now };
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.pausedAt == null) return state;
  const gap = Math.max(0, now - state.pausedAt);
  return {
    ...state,
    pausedAt: null,
    segmentPausedMs: state.segmentPausedMs + gap,
    meetingPausedMs: state.meetingPausedMs + gap,
  };
}

/** +1 min: sixty more seconds for the current segment only. */
export function addMinute(state: TimerState): TimerState {
  const key = state.segment;
  return { ...state, extraMs: { ...state.extraMs, [key]: (state.extraMs[key] ?? 0) + MINUTE } };
}

/**
 * Move to the next segment at `now`. A paused clock resumes. On the last
 * segment it returns the state unchanged; ending is a separate step.
 */
export function advance(state: TimerState, now: number, to?: L10Segment): TimerState {
  const next = to ?? nextSegment(state.segment);
  if (!next || next === state.segment) return state;
  const running = resume(state, now);
  return {
    ...running,
    finished: { ...running.finished, [running.segment]: segmentElapsedMs(running, now) },
    segment: next,
    segmentStartedAt: now,
    segmentPausedMs: 0,
  };
}

export function segmentState(state: TimerState, key: L10Segment, now: number): SegmentState {
  if (key === state.segment) return isOverTime(state, now) ? "current-over" : "current";
  const done = state.finished[key];
  if (done != null) return done > allowanceMs(state, key) ? "done-over" : "done";
  return L10_SEGMENTS.indexOf(key) < L10_SEGMENTS.indexOf(state.segment) ? "done" : "upcoming";
}

// ── Formatting ────────────────────────────────────────────────────────

function clock(totalSeconds: number, padMinutes: boolean): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = padMinutes ? String(minutes).padStart(2, "0") : String(minutes);
  return `${mm}:${String(seconds).padStart(2, "0")}`;
}

/** Elapsed time, rounded down: "4:07". `pad` gives "04:07". */
export function formatClock(valueMs: number, pad = false): string {
  return clock(Math.floor(Math.max(0, valueMs) / 1000), pad);
}

/**
 * The countdown. Before the allowance runs out it rounds up, so a fresh
 * five-minute segment reads 5:00. Over time it reads "+m:ss".
 */
export function formatRemaining(valueMs: number): string {
  if (valueMs >= 0) return clock(Math.ceil(valueMs / 1000), false);
  return `+${clock(Math.floor(-valueMs / 1000), false)}`;
}

/** Meeting clock against the 90:00 plan: "34:12". */
export function formatTotal(valueMs: number): string {
  return formatClock(valueMs, true);
}
