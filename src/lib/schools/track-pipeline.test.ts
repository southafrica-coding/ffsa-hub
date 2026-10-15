import { describe, it, expect } from "vitest";
import { summariseTrack, summariseAcceptedTrack, type PipelinePerson } from "./track-pipeline";

const segs = ["FFX", "FFBX", "FFWX"].map((code, i) => ({ id: code, code, name: code, sequence: i, start_date: null, end_date: null }));

const person = (kind: PipelinePerson["track"]["kind"], codes: string[] = [], accepted = true): PipelinePerson => ({
  applicationId: Math.random().toString(),
  name: "x",
  email: null,
  status: accepted ? "accepted" : "submitted",
  accepted,
  enrollmentId: null,
  track: { kind, codes, source: "enrollment" },
  survey: { state: "not_sent", sentAt: null, answeredAt: null, remindedAt: null },
});

describe("track stats", () => {
  const people = [
    person("whole"),
    person("whole"),
    person("segments", ["FFX"]),
    person("segments", ["FFX", "FFWX"]),
    person("segments", ["FFBX"], false),
    person("unknown"),
  ];

  it("counts whole-programme people once, not in every course", () => {
    const s = summariseTrack(people, segs);
    expect(s.whole).toBe(2);
    expect(s.bySegment.map((b) => [b.code, b.expected, b.accepted])).toEqual([
      ["FFX", 2, 2],
      ["FFBX", 1, 0],
      ["FFWX", 1, 1],
    ]);
  });

  it("does the same for the leaders' accepted view", () => {
    const s = summariseAcceptedTrack(people, segs);
    expect(s.whole).toBe(2);
    expect(s.bySegment.map((b) => b.expected)).toEqual([2, 0, 1]);
  });
});
