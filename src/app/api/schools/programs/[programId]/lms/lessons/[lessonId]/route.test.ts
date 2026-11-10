import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";

// Edit path used by the Classroom tab: PATCH a lesson's title and content,
// and the matching course / module rename routes.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  canEdit: true,
  lessonProgram: "p1" as string | null,
  updates: [] as Array<{ table: string; id: string; patch: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));
vi.mock("@/services/lms-content", () => ({
  resolveLmsAccess: async () => ({ canEdit: state.canEdit, canReadPublished: state.canEdit }),
  programIdForLesson: async () => state.lessonProgram,
  programIdForModule: async () => state.lessonProgram,
  programIdForCourse: async () => state.lessonProgram,
  updateLesson: async (_s: unknown, id: string, patch: Record<string, unknown>) => {
    state.updates.push({ table: "lms_lessons", id, patch });
    return { data: { id, ...patch }, error: null };
  },
  updateModule: async (_s: unknown, id: string, patch: Record<string, unknown>) => {
    state.updates.push({ table: "lms_modules", id, patch });
    return { data: { id, ...patch }, error: null };
  },
  updateCourse: async (_s: unknown, id: string, patch: Record<string, unknown>) => {
    state.updates.push({ table: "lms_courses", id, patch });
    return { data: { id, ...patch }, error: null };
  },
  deleteLesson: async () => ({ error: null }),
  deleteModule: async () => ({ error: null }),
  deleteCourse: async () => ({ error: null }),
  getCourseTree: async () => ({ data: null, error: null }),
}));

import { PATCH } from "./route";
import { PATCH as PATCH_MODULE } from "../../modules/[moduleId]/route";
import { PATCH as PATCH_COURSE } from "../../courses/[courseId]/route";
import { lessonEditPayload } from "@/lib/schools/lms-content";

const ctx = { params: Promise.resolve({ programId: "p1", lessonId: "l1" }) };

function patch(body: unknown) {
  return new Request("http://hub.test/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.fake = createFakeSupabase({ user: { id: "leader" } });
  state.canEdit = true;
  state.lessonProgram = "p1";
  state.updates = [];
});

describe("PATCH /api/schools/programs/[programId]/lms/lessons/[lessonId]", () => {
  it("saves a rich_text lesson's new title and body", async () => {
    const body = lessonEditPayload({ content_type: "rich_text" }, { title: " Week 2 ", body: "Read Acts 2", link_url: "" });
    const res = await PATCH(patch(body), ctx);
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([
      {
        table: "lms_lessons",
        id: "l1",
        patch: { title: "Week 2", content_type: "rich_text", body: "Read Acts 2", link_url: null },
      },
    ]);
  });

  it("saves a link lesson's new URL and clears body", async () => {
    const body = lessonEditPayload({ content_type: "link" }, { title: "Video", body: "stale", link_url: "https://example.org/v" });
    const res = await PATCH(patch(body), ctx);
    expect(res.status).toBe(200);
    expect(state.updates[0].patch).toEqual({
      title: "Video",
      content_type: "link",
      body: null,
      link_url: "https://example.org/v",
    });
  });

  it("400 for an empty body or a non-http link, and writes nothing", async () => {
    expect((await PATCH(patch(lessonEditPayload({ content_type: "rich_text" }, { title: "T", body: " ", link_url: "" })), ctx)).status).toBe(400);
    expect((await PATCH(patch(lessonEditPayload({ content_type: "link" }, { title: "T", body: "", link_url: "javascript:x" })), ctx)).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("403 without manage", async () => {
    state.canEdit = false;
    expect((await PATCH(patch({ title: "x" }), ctx)).status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("404 when the lesson belongs to another school", async () => {
    state.lessonProgram = "other";
    expect((await PATCH(patch({ title: "x" }), ctx)).status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});

describe("rename courses and modules", () => {
  it("renames a module", async () => {
    const res = await PATCH_MODULE(patch({ title: "Module 1: Gospels" }), {
      params: Promise.resolve({ programId: "p1", moduleId: "m1" }),
    });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ table: "lms_modules", id: "m1", patch: { title: "Module 1: Gospels" } }]);
  });

  it("renames a course and rejects a blank name", async () => {
    const c = { params: Promise.resolve({ programId: "p1", courseId: "c1" }) };
    expect((await PATCH_COURSE(patch({ title: "  " }), c)).status).toBe(400);
    expect((await PATCH_COURSE(patch({ title: "Foundations" }), c)).status).toBe(200);
    expect(state.updates).toEqual([{ table: "lms_courses", id: "c1", patch: { title: "Foundations" } }]);
  });
});
