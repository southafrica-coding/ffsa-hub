import { describe, expect, it } from "vitest";
import {
  buildCourseTree,
  buildReorderUpdates,
  bySortOrder,
  deriveLmsAccess,
  isClassroomEnrollment,
  moveId,
  nextSortOrder,
  normaliseLinkUrl,
  publishedOnly,
  validateCourseInput,
  validateCoursePatch,
  lessonDraftReady,
  validateLessonInput,
  validateLessonPatch,
  validateModulePatch,
  type LmsCourse,
  type LmsLesson,
  type LmsModule,
} from "./lms-content";
import { linkifyLessonText, sanitizeLessonBody } from "./lms-render";

const at = "2026-11-09T00:00:00Z";
const course = (over: Partial<LmsCourse> = {}): LmsCourse => ({
  id: "c1",
  program_id: "p1",
  title: "Foundations",
  description: null,
  sort_order: 0,
  published: true,
  created_by: null,
  created_at: at,
  updated_at: at,
  ...over,
});
const mod = (over: Partial<LmsModule>): LmsModule => ({
  id: "m",
  course_id: "c1",
  title: "Module",
  sort_order: 0,
  published: true,
  created_at: at,
  updated_at: at,
  ...over,
});
const lesson = (over: Partial<LmsLesson>): LmsLesson => ({
  id: "l",
  module_id: "m1",
  title: "Lesson",
  content_type: "rich_text",
  body: "Hi",
  link_url: null,
  sort_order: 0,
  published: true,
  created_at: at,
  updated_at: at,
  ...over,
});

describe("ordering", () => {
  it("sorts by sort_order, then created_at, then id", () => {
    const rows = [
      { id: "b", sort_order: 1, created_at: at },
      { id: "c", sort_order: 0, created_at: "2026-11-10T00:00:00Z" },
      { id: "a", sort_order: 0, created_at: at },
    ];
    expect(bySortOrder(rows).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("appends new siblings after the largest sort_order", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 7 }, { sort_order: 3 }])).toBe(8);
  });

  it("moves an id up or down and stops at the edges", () => {
    expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b"], "zz", 1)).toEqual(["a", "b"]);
  });

  it("turns an ordered id list into sort_order updates", () => {
    expect(buildReorderUpdates(["a", "b", "c"], ["c", "a", "b"])).toEqual({
      ok: true,
      value: [
        { id: "c", sort_order: 0 },
        { id: "a", sort_order: 1 },
        { id: "b", sort_order: 2 },
      ],
    });
  });

  it("rejects a reorder that drops, adds, or repeats ids", () => {
    expect(buildReorderUpdates(["a", "b"], ["a"]).ok).toBe(false);
    expect(buildReorderUpdates(["a", "b"], ["a", "b", "x"]).ok).toBe(false);
    expect(buildReorderUpdates(["a", "b"], ["a", "x"]).ok).toBe(false);
    expect(buildReorderUpdates(["a", "b"], ["a", "a"]).ok).toBe(false);
    expect(buildReorderUpdates(["a"], "a").ok).toBe(false);
    expect(buildReorderUpdates(["a"], [1]).ok).toBe(false);
  });
});

describe("publish filtering", () => {
  const modules = [
    mod({ id: "m2", sort_order: 1, published: false }),
    mod({ id: "m1", sort_order: 0 }),
    mod({ id: "mx", course_id: "other" }),
  ];
  const lessons = [
    lesson({ id: "l2", module_id: "m1", sort_order: 1, published: false }),
    lesson({ id: "l1", module_id: "m1", sort_order: 0 }),
    lesson({ id: "l3", module_id: "m2" }),
  ];

  it("keeps drafts, sorted, for editors", () => {
    const tree = buildCourseTree(course({ published: false }), modules, lessons, { includeUnpublished: true });
    expect(tree?.modules.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(tree?.modules[0].lessons.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(tree?.modules[1].lessons.map((l) => l.id)).toEqual(["l3"]);
  });

  it("drops a draft course, draft modules, and draft lessons for readers", () => {
    expect(buildCourseTree(course({ published: false }), modules, lessons, { includeUnpublished: false })).toBeNull();
    const tree = buildCourseTree(course(), modules, lessons, { includeUnpublished: false });
    expect(tree?.modules.map((m) => m.id)).toEqual(["m1"]);
    expect(tree?.modules[0].lessons.map((l) => l.id)).toEqual(["l1"]);
  });

  it("publishedOnly strips anything unpublished at any level", () => {
    const draftTree = buildCourseTree(course(), modules, lessons, { includeUnpublished: true })!;
    const hiddenCourse = { ...draftTree, id: "c2", published: false };
    const out = publishedOnly([draftTree, hiddenCourse]);
    expect(out.map((c) => c.id)).toEqual(["c1"]);
    expect(out[0].modules.map((m) => m.id)).toEqual(["m1"]);
    expect(out[0].modules[0].lessons.map((l) => l.id)).toEqual(["l1"]);
  });
});

describe("validation", () => {
  it("requires a course title and trims it", () => {
    expect(validateCourseInput({ title: "  " }).ok).toBe(false);
    expect(validateCourseInput({ title: "x".repeat(201) }).ok).toBe(false);
    expect(validateCourseInput({ title: " Bible ", description: "" })).toEqual({
      ok: true,
      value: { title: "Bible", description: null },
    });
  });

  it("course and module patches need something to change and a boolean published", () => {
    expect(validateCoursePatch({}).ok).toBe(false);
    expect(validateCoursePatch({ published: "yes" }).ok).toBe(false);
    expect(validateCoursePatch({ published: true })).toEqual({ ok: true, value: { published: true } });
    expect(validateModulePatch({ title: "" }).ok).toBe(false);
    expect(validateModulePatch({ published: false })).toEqual({ ok: true, value: { published: false } });
  });

  it("keeps Add lesson off while the text body is empty or whitespace", () => {
    expect(lessonDraftReady({ title: "Week 1", content_type: "rich_text", body: "", link_url: "" })).toBe(false);
    expect(lessonDraftReady({ title: "Week 1", content_type: "rich_text", body: "   ", link_url: "" })).toBe(false);
    expect(lessonDraftReady({ title: "  ", content_type: "rich_text", body: "Read Acts", link_url: "" })).toBe(false);
    expect(lessonDraftReady({ title: "Week 1", content_type: "rich_text", body: "Read Acts", link_url: "" })).toBe(true);
    expect(
      lessonDraftReady({ title: "Video", content_type: "link", body: "", link_url: "javascript:alert(1)" })
    ).toBe(false);
  });

  it("a rich_text lesson needs a body and clears link_url", () => {
    expect(validateLessonInput({ title: "T", content_type: "rich_text" }).ok).toBe(false);
    expect(validateLessonInput({ title: "T", content_type: "rich_text", body: "   " }).ok).toBe(false);
    expect(
      validateLessonInput({ title: "T", content_type: "rich_text", body: "Read John 1", link_url: "https://x.test" })
    ).toEqual({
      ok: true,
      value: { title: "T", content_type: "rich_text", body: "Read John 1", link_url: null },
    });
  });

  it("a link lesson needs an http(s) URL and clears body", () => {
    expect(validateLessonInput({ title: "T", content_type: "link" }).ok).toBe(false);
    expect(validateLessonInput({ title: "T", content_type: "link", link_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateLessonInput({ title: "T", content_type: "link", link_url: "example.org" }).ok).toBe(false);
    expect(
      validateLessonInput({ title: "T", content_type: "link", link_url: " https://example.org/a ", body: "x" })
    ).toEqual({
      ok: true,
      value: { title: "T", content_type: "link", body: null, link_url: "https://example.org/a" },
    });
  });

  it("rejects unknown content types", () => {
    expect(validateLessonInput({ title: "T", content_type: "video", body: "x" }).ok).toBe(false);
  });

  it("a lesson patch that touches content must carry the full content", () => {
    expect(validateLessonPatch({ body: "new" }).ok).toBe(false);
    expect(validateLessonPatch({ content_type: "link", link_url: "https://a.test" })).toEqual({
      ok: true,
      value: { content_type: "link", body: null, link_url: "https://a.test/" },
    });
    expect(validateLessonPatch({ published: true })).toEqual({ ok: true, value: { published: true } });
  });

  it("normaliseLinkUrl only accepts absolute http(s)", () => {
    expect(normaliseLinkUrl("https://a.test/x?y=1")).toBe("https://a.test/x?y=1");
    expect(normaliseLinkUrl("ftp://a.test")).toBeNull();
    expect(normaliseLinkUrl("data:text/html,hi")).toBeNull();
    expect(normaliseLinkUrl(42)).toBeNull();
  });
});

describe("access", () => {
  it("only managers edit; staff and enrolled students read published", () => {
    expect(deriveLmsAccess({ canManage: true, isStaff: false, isEnrolled: false })).toEqual({
      canEdit: true,
      canReadPublished: true,
    });
    expect(deriveLmsAccess({ canManage: false, isStaff: true, isEnrolled: false })).toEqual({
      canEdit: false,
      canReadPublished: true,
    });
    expect(deriveLmsAccess({ canManage: false, isStaff: false, isEnrolled: true })).toEqual({
      canEdit: false,
      canReadPublished: true,
    });
    expect(deriveLmsAccess({ canManage: false, isStaff: false, isEnrolled: false })).toEqual({
      canEdit: false,
      canReadPublished: false,
    });
  });

  it("removed, dismissed, and left students are not in the classroom", () => {
    expect(isClassroomEnrollment({ status: "arrived", removed_at: null })).toBe(true);
    expect(isClassroomEnrollment({ status: "waiting_for_arrival", removed_at: null })).toBe(true);
    expect(isClassroomEnrollment({ status: "graduated", removed_at: null })).toBe(true);
    expect(isClassroomEnrollment({ status: "arrived", removed_at: at })).toBe(false);
    expect(isClassroomEnrollment({ status: "dismissed", removed_at: null })).toBe(false);
    expect(isClassroomEnrollment({ status: "decided_to_leave", removed_at: null })).toBe(false);
  });
});

describe("lesson body rendering", () => {
  it("escapes raw HTML instead of rendering it", () => {
    const html = sanitizeLessonBody('<p>Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<p>");
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;p&gt;");
    expect(html).toContain("javascript:alert(1)");
    expect(html).not.toContain('href="javascript:');
  });

  it("linkifies plain http and https URLs only", () => {
    const html = linkifyLessonText("Read https://a.test/acts and http://b.test/notes.");
    expect(html).toContain('<a href="https://a.test/acts" target="_blank" rel="noopener noreferrer">https://a.test/acts</a>');
    expect(html).toContain('<a href="http://b.test/notes" target="_blank" rel="noopener noreferrer">http://b.test/notes</a>');
    expect(html.endsWith(".")).toBe(true);
    const hostile = linkifyLessonText("javascript:alert(1) data:text/html,hi");
    expect(hostile).not.toContain("<a ");
    expect(hostile).toContain("javascript:alert(1)");
    expect(hostile).toContain("data:text/html,hi");
  });

  it("keeps plain-text line breaks and escapes markup-looking text", () => {
    expect(sanitizeLessonBody("Line 1\nLine 2 & more")).toBe("Line 1<br/>Line 2 &amp; more");
  });
});
