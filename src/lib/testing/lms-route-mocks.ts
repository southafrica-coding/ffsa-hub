// Shared vi.mock wiring for the slice-2 assignment route tests. Each test
// file calls vi.mock with these factories and drives `lmsTestState`.
// Test-only.

import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { createFakeLmsService, emptyWorld, type LmsWorld } from "@/lib/testing/fake-lms-assignments";
import { downloadFileName } from "@/lib/schools/lms-assignments";

export const lmsTestState: {
  world: LmsWorld;
  service: ReturnType<typeof createFakeLmsService>;
  uploaded: Set<string>;
  signed: string[];
  /** The name each signed download would save as. */
  downloadNames: string[];
} = (() => {
  const world = emptyWorld();
  return { world, service: createFakeLmsService(world), uploaded: new Set<string>(), signed: [], downloadNames: [] };
})();

export function resetLmsWorld(now = new Date("2026-11-09T10:00:00Z")): LmsWorld {
  const world = emptyWorld();
  world.now = () => now;
  lmsTestState.world = world;
  lmsTestState.service = createFakeLmsService(world);
  lmsTestState.uploaded = new Set();
  lmsTestState.signed = [];
  lmsTestState.downloadNames = [];
  return world;
}

export function serverClientMock() {
  return {
    createClient: async () => {
      const w = lmsTestState.world;
      return createFakeSupabase({
        user: w.userId ? { id: w.userId } : null,
        resolve: (q) => {
          if (q.table !== "enrollments") return { data: [] };
          const id = q.filters.find((f) => f.op === "eq" && f.args[0] === "id")?.args[1];
          // RLS on enrollments: own rows only for a student.
          const row = w.enrollments.find((e) => e.id === id && e.user_id === w.userId);
          return { data: row ? [row] : [] };
        },
      }).client;
    },
  };
}

export function programViewerMock() {
  return {
    resolveProgramViewer: async (_s: unknown, userId: string, programId: string) => {
      const w = lmsTestState.world;
      const canManage = !!w.editors.get(programId)?.has(userId);
      const isStaff = !!w.staff.get(programId)?.has(userId);
      return {
        userId,
        canManage,
        isStaff,
        canManageFinance: false,
        hasSchoolsGrant: false,
        staffScoped: isStaff && !canManage,
        showFees: !isStaff || canManage,
      };
    },
  };
}

export function serviceMock() {
  const names = [
    "getAssignment",
    "listAssignmentsForProgram",
    "programIdForCourse",
    "createAssignment",
    "updateAssignment",
    "deleteAssignment",
    "countSubmittedAttempts",
    "countSubmittedAttemptsForCourse",
    "gradingRoster",
    "listSubmittedAttempts",
    "listAttempts",
    "listAttemptsForEnrollment",
    "getSubmission",
    "submissionIsMine",
    "getGradeForSubmission",
    "upsertGrade",
    "releaseGrades",
    "insertAttempt",
    "updateDraft",
    "insertFileRow",
    "getFile",
    "deleteFileRow",
    "deleteDraft",
  ] as const;
  return Object.fromEntries(
    names.map((n) => [
      n,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (...args: unknown[]) => (lmsTestState.service as any)[n](...args),
    ])
  );
}

export function storageMock() {
  return {
    // Same naming as the real signDownload.
    signDownload: async (file: { storage_path: string; file_name: string; mime: string }) => {
      lmsTestState.signed.push(file.storage_path);
      lmsTestState.downloadNames.push(downloadFileName(file.file_name, file.mime));
      return { url: `https://storage.test/sign/${file.storage_path}?ttl=300`, error: null };
    },
    signUpload: async (path: string) => ({
      data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: "t", path },
      error: null,
    }),
    existingObjects: async (folder: string) =>
      new Set([...lmsTestState.uploaded].filter((p) => p.startsWith(`${folder}/`))),
    removeObjects: async () => undefined,
  };
}

export function jsonRequest(method: string, body?: unknown) {
  return new Request("http://hub.test/api", {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
