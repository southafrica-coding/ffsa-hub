import { guardUser, isGuard } from "@/lib/schools/lms-guard";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { json } from "@/lib/schools/lms-http";

// POST /api/schools/programs/:programId/learning-courses/:courseId/agent
//
// Not switched on. A later slice should call the existing Anthropic client
// (src/app/api/assistant/route.ts) with buildCourseAgentContext()
// (src/lib/schools/course-agent.ts). The repo has no Mindjoy (or other
// tutor) integration, and this route does not add one.
//
// Who will be allowed: a manager of the school, or a student enrolled in it
// (removed_at is null) once the course belongs to that school. The response
// deliberately does not include the course material.

type Ctx = { params: Promise<{ programId: string; courseId: string }> };

function notEnabled() {
  return json(
    {
      error: "course_agent_not_enabled",
      message:
        "Course agents are not switched on. When they are, they will use the hub's existing Anthropic client and only this course's saved design. No third-party tutor is connected.",
    },
    501
  );
}

export async function POST(_request: Request, context: Ctx) {
  const { programId, courseId } = await context.params;
  const guard = await guardUser();
  if (isGuard(guard)) return guard.response;

  if (await userCanManageProgram(guard.supabase, guard.user.id, programId)) {
    return notEnabled();
  }

  const { data: enrolled } = await guard.supabase
    .from("enrollments")
    .select("id")
    .eq("program_id", programId)
    .eq("user_id", guard.user.id)
    .is("removed_at", null)
    .limit(1);
  if (!enrolled || enrolled.length === 0) {
    return json({ error: "forbidden", message: "You are not in this school." }, 403);
  }

  // billing_courses is newer than the generated Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: course } = await (guard.supabase as any)
    .from("billing_courses")
    .select("id")
    .eq("id", courseId)
    .eq("program_id", programId)
    .maybeSingle();
  if (!course) return json({ error: "not_found", message: "Course not found in this school." }, 404);
  return notEnabled();
}
