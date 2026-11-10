import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, lmsTestState, resetLmsWorld } from "@/lib/testing/lms-route-mocks";
import { seedTwoSchools } from "@/lib/testing/fake-lms-assignments";

// Student-side assignment routes. Services are the in-memory fake that
// mimics migration 310's RLS and triggers.

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/testing/lms-route-mocks")).serverClientMock());
vi.mock("@/lib/schools/program-staff-access", async () =>
  (await import("@/lib/testing/lms-route-mocks")).programViewerMock()
);
vi.mock("@/services/lms-assignments", async () => (await import("@/lib/testing/lms-route-mocks")).serviceMock());
vi.mock("@/lib/schools/lms-storage", async () => (await import("@/lib/testing/lms-route-mocks")).storageMock());

import { GET as list } from "./route";
import { GET as detail } from "./[assignmentId]/route";
import { DELETE as discardDraft, PUT as saveDraft } from "./[assignmentId]/draft/route";
import { POST as submit } from "./[assignmentId]/submit/route";
import { POST as upload } from "./[assignmentId]/files/route";
import { DELETE as removeFile, GET as download } from "./[assignmentId]/files/[fileId]/route";

let ids: ReturnType<typeof seedTwoSchools>;
const as = (userId: string | null) => {
  lmsTestState.world.userId = userId;
};
const p = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  // Route late checks use the real clock; pin it to the fake world's now.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
  ids = seedTwoSchools(resetLmsWorld());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("student assignment routes", () => {
  it("401 signed out; 403 on someone else's enrolment", async () => {
    as(null);
    expect((await list(jsonRequest("GET"), p({ enrollmentId: ids.e1 }))).status).toBe(401);
    as(ids.s2);
    // S2 cannot see S1's enrolment row at all.
    expect((await list(jsonRequest("GET"), p({ enrollmentId: ids.e1 }))).status).toBe(404);
    expect(
      (await submit(jsonRequest("POST", { body_text: "x" }), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).status
    ).toBe(404);
  });

  it("403 for a removed or dismissed enrolment", async () => {
    lmsTestState.world.enrollments[0].status = "dismissed";
    as(ids.s1);
    expect((await list(jsonRequest("GET"), p({ enrollmentId: ids.e1 }))).status).toBe(403);
  });

  it("lists published assignments only; unpublished and other-school ones are 404", async () => {
    as(ids.s1);
    const body = await (await list(jsonRequest("GET"), p({ enrollmentId: ids.e1 }))).json();
    expect(body.items.map((i: { assignment: { title: string } }) => i.assignment.title).sort()).toEqual([
      "Closed",
      "Essay",
      "Late ok",
    ]);
    expect((await detail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.hidden }))).status).toBe(404);
    expect((await detail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.inB }))).status).toBe(404);
  });

  it("student cannot read another student's submission or file", async () => {
    as(ids.s1);
    const up = await (
      await upload(
        jsonRequest("POST", { file_name: "mine.pdf", mime: "application/pdf", size_bytes: 10 }),
        p({ enrollmentId: ids.e1, assignmentId: ids.onTime })
      )
    ).json();
    lmsTestState.uploaded.add(up.upload.path);
    await submit(jsonRequest("POST", { body_text: "S1 work" }), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }));

    as(ids.s2);
    const own = await (await detail(jsonRequest("GET"), p({ enrollmentId: ids.e2, assignmentId: ids.onTime }))).json();
    expect(own.attempts).toEqual([]);
    expect(own.draft).toBeNull();
    // Under S2's own enrolment URL, S1's file id is not found.
    const dl = await download(jsonRequest("GET"), p({ enrollmentId: ids.e2, assignmentId: ids.onTime, fileId: up.file.id }));
    expect(dl.status).toBe(404);
    expect(lmsTestState.signed).toEqual([]);
  });

  it("grade hidden until released", async () => {
    as(ids.s1);
    const { attempt } = await (
      await submit(jsonRequest("POST", { body_text: "Work" }), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))
    ).json();
    // Staff grade, held.
    lmsTestState.world.grades.push({
      id: "g-held",
      submission_id: attempt.id,
      points: 7,
      feedback: "held",
      graded_by: ids.staffA,
      graded_at: new Date().toISOString(),
      released_at: null,
      released_by: null,
      updated_at: new Date().toISOString(),
    });
    let body = await (await detail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).json();
    expect(body.attempts[0].grade).toBeNull();
    expect(JSON.stringify(body)).not.toContain("held");
    lmsTestState.world.grades[0].released_at = new Date().toISOString();
    body = await (await detail(jsonRequest("GET"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }))).json();
    expect(body.attempts[0].grade.points).toBe(7);
  });

  it("late: allow_late=false → 409 late_not_allowed (also for resubmits); allow_late=true → accepted as late", async () => {
    as(ids.s1);
    const blocked = await submit(jsonRequest("POST", { body_text: "too late" }), p({ enrollmentId: ids.e1, assignmentId: ids.closed }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("late_not_allowed");

    const ok = await submit(jsonRequest("POST", { body_text: "late but ok" }), p({ enrollmentId: ids.e1, assignmentId: ids.lateOk }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).attempt.is_late).toBe(true);

    // Resubmission after the deadline on a closed assignment.
    const closed = lmsTestState.world.assignments.find((a) => a.id === ids.closed)!;
    closed.due_at = new Date(Date.parse("2026-11-09T10:00:00Z") + 60_000).toISOString();
    expect(
      (await submit(jsonRequest("POST", { body_text: "on time" }), p({ enrollmentId: ids.e1, assignmentId: ids.closed }))).status
    ).toBe(201);
    closed.due_at = new Date(Date.parse("2026-11-09T10:00:00Z") - 60_000).toISOString();
    const resub = await submit(jsonRequest("POST", { body_text: "again" }), p({ enrollmentId: ids.e1, assignmentId: ids.closed }));
    expect(resub.status).toBe(409);
  });

  it("draft save, file add/remove, discard; type and size rules", async () => {
    as(ids.s1);
    const ctx = p({ enrollmentId: ids.e1, assignmentId: ids.onTime });
    expect((await saveDraft(jsonRequest("PUT", { link_url: "javascript:alert(1)" }), ctx)).status).toBe(400);
    expect((await saveDraft(jsonRequest("PUT", { body_text: "half done" }), ctx)).status).toBe(201);
    expect((await saveDraft(jsonRequest("PUT", { body_text: "more done" }), ctx)).status).toBe(200);
    expect(lmsTestState.world.submissions.filter((s) => s.status === "draft")).toHaveLength(1);

    expect(
      (await upload(jsonRequest("POST", { file_name: "x.exe", mime: "application/x-msdownload", size_bytes: 10 }), ctx)).status
    ).toBe(400);
    expect(
      (await upload(jsonRequest("POST", { file_name: "big.pdf", mime: "application/pdf", size_bytes: 21 * 1024 * 1024 }), ctx)).status
    ).toBe(400);
    const up = await (await upload(jsonRequest("POST", { file_name: "a.txt", mime: "text/plain", size_bytes: 5 }), ctx)).json();
    const rm = await removeFile(jsonRequest("DELETE"), p({ enrollmentId: ids.e1, assignmentId: ids.onTime, fileId: up.file.id }));
    expect(rm.status).toBe(200);
    expect((await discardDraft(jsonRequest("DELETE"), ctx)).status).toBe(200);
    expect(lmsTestState.world.submissions).toHaveLength(0);
  });

  it("submit with nothing in it is a 400", async () => {
    as(ids.s1);
    const res = await submit(jsonRequest("POST", {}), p({ enrollmentId: ids.e1, assignmentId: ids.onTime }));
    expect(res.status).toBe(400);
  });
});
