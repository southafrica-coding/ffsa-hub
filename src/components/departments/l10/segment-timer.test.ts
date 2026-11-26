import { describe, expect, it } from "vitest";
import {
  addMinute,
  advance,
  allowanceMs,
  createTimer,
  formatClock,
  formatRemaining,
  formatTotal,
  isOverTime,
  isPaused,
  meetingElapsedMs,
  pause,
  remainingMs,
  resume,
  segmentElapsedMs,
  segmentState,
  timerFromMeeting,
} from "./segment-timer";
import { MEETING_MINUTES, SEGMENTS, nextSegment } from "./segments";

const T0 = Date.UTC(2026, 11, 1, 7, 0, 0);
const s = (seconds: number) => T0 + seconds * 1000;

describe("segments", () => {
  it("runs the seven L10 segments in order, 90 minutes in all", () => {
    expect(SEGMENTS.map((x) => [x.key, x.minutes])).toEqual([
      ["segue", 5],
      ["scorecard", 5],
      ["rock_review", 5],
      ["headlines", 5],
      ["todo_list", 5],
      ["ids", 60],
      ["conclude", 5],
    ]);
    expect(MEETING_MINUTES).toBe(90);
  });

  it("moves to the next segment and stops after Conclude", () => {
    expect(nextSegment("segue")).toBe("scorecard");
    expect(nextSegment("todo_list")).toBe("ids");
    expect(nextSegment("ids")).toBe("conclude");
    expect(nextSegment("conclude")).toBeNull();
  });
});

describe("segment timer", () => {
  it("counts elapsed up and remaining down against the allowance", () => {
    const timer = createTimer({ meetingStartedAt: T0 });
    expect(allowanceMs(timer)).toBe(300_000);
    expect(segmentElapsedMs(timer, s(72))).toBe(72_000);
    expect(remainingMs(timer, s(72))).toBe(228_000);
    expect(formatRemaining(remainingMs(timer, s(72)))).toBe("3:48");
    expect(formatRemaining(remainingMs(timer, T0))).toBe("5:00");
  });

  it("+1 min adds sixty seconds to the current segment only", () => {
    const timer = addMinute(createTimer({ meetingStartedAt: T0 }));
    expect(allowanceMs(timer)).toBe(360_000);
    expect(allowanceMs(timer, "scorecard")).toBe(300_000);
    expect(allowanceMs(addMinute(timer))).toBe(420_000);
  });

  it("does not advance while paused, and resumes where it left off", () => {
    let timer = createTimer({ meetingStartedAt: T0 });
    timer = pause(timer, s(60));
    expect(isPaused(timer)).toBe(true);
    expect(segmentElapsedMs(timer, s(600))).toBe(60_000);
    expect(meetingElapsedMs(timer, s(600))).toBe(60_000);
    expect(pause(timer, s(700))).toBe(timer);
    timer = resume(timer, s(600));
    expect(isPaused(timer)).toBe(false);
    expect(segmentElapsedMs(timer, s(610))).toBe(70_000);
    expect(meetingElapsedMs(timer, s(610))).toBe(70_000);
    expect(resume(timer, s(700))).toBe(timer);
  });

  it("goes over time only after the allowance, and shows +m:ss", () => {
    const timer = createTimer({ meetingStartedAt: T0 });
    expect(isOverTime(timer, s(300))).toBe(false);
    expect(formatRemaining(remainingMs(timer, s(300)))).toBe("0:00");
    expect(isOverTime(timer, s(301))).toBe(true);
    expect(formatRemaining(remainingMs(timer, s(301)))).toBe("+0:01");
    expect(formatRemaining(remainingMs(timer, s(300 + 125)))).toBe("+2:05");
    expect(isOverTime(addMinute(timer), s(301))).toBe(false);
  });

  it("advances in order, records finished segments, and marks overtime on the rail", () => {
    let timer = createTimer({ meetingStartedAt: T0 });
    timer = advance(timer, s(320));
    expect(timer.segment).toBe("scorecard");
    expect(timer.finished.segue).toBe(320_000);
    expect(segmentState(timer, "segue", s(330))).toBe("done-over");
    expect(segmentState(timer, "scorecard", s(330))).toBe("current");
    expect(segmentState(timer, "ids", s(330))).toBe("upcoming");
    expect(segmentElapsedMs(timer, s(330))).toBe(10_000);
    expect(meetingElapsedMs(timer, s(330))).toBe(330_000);
    timer = advance(timer, s(400));
    expect(segmentState(timer, "scorecard", s(400))).toBe("done");
    expect(segmentState(timer, "rock_review", s(800))).toBe("current-over");
  });

  it("advancing a paused clock resumes it and does not count the pause", () => {
    let timer = pause(createTimer({ meetingStartedAt: T0 }), s(60));
    timer = advance(timer, s(200));
    expect(timer.finished.segue).toBe(60_000);
    expect(isPaused(timer)).toBe(false);
    expect(meetingElapsedMs(timer, s(200))).toBe(60_000);
  });

  it("stays on Conclude: ending is a separate step", () => {
    const timer = createTimer({ meetingStartedAt: T0, segment: "conclude", segmentStartedAt: s(5000) });
    expect(advance(timer, s(5100))).toBe(timer);
  });

  it("rebuilds from the server's segment timings", () => {
    const timer = timerFromMeeting({
      started_at: new Date(T0).toISOString(),
      segment_timings: {
        segue: { started_at: new Date(T0).toISOString(), ended_at: new Date(s(400)).toISOString() },
        scorecard: { started_at: new Date(s(400)).toISOString(), ended_at: null },
      },
    });
    expect(timer.segment).toBe("scorecard");
    expect(timer.segmentStartedAt).toBe(s(400));
    expect(timer.finished).toEqual({ segue: 400_000 });
    expect(timerFromMeeting({ started_at: new Date(T0).toISOString(), segment_timings: {} }).segment).toBe("segue");
  });

  it("prefers the server's current_segment when it is set", () => {
    const timer = timerFromMeeting({
      started_at: new Date(T0).toISOString(),
      current_segment: "rock_review",
      segment_timings: {
        segue: { started_at: new Date(T0).toISOString(), ended_at: new Date(s(400)).toISOString() },
        scorecard: { started_at: new Date(s(400)).toISOString(), ended_at: new Date(s(700)).toISOString() },
        rock_review: { started_at: new Date(s(700)).toISOString(), ended_at: null },
      },
    });
    expect(timer.segment).toBe("rock_review");
    expect(timer.segmentStartedAt).toBe(s(700));
    expect(timer.finished.segue).toBe(400_000);
    expect(timer.finished.scorecard).toBe(300_000);
  });

});

describe("clock formatting", () => {
  it("formats m:ss, mm:ss and the 90:00 total", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_999)).toBe("1:05");
    expect(formatClock(65_000, true)).toBe("01:05");
    expect(formatTotal(34 * 60_000 + 12_000)).toBe("34:12");
    expect(formatTotal(MEETING_MINUTES * 60_000)).toBe("90:00");
    expect(formatTotal(101 * 60_000 + 5_000)).toBe("101:05");
    expect(formatClock(-5_000)).toBe("0:00");
  });
});
