import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGraderCandidates } from "@/lib/schools/grader-candidates";
import { guardProgram, isGuard } from "@/lib/schools/lms-guard";
import { dbError, json } from "@/lib/schools/lms-http";

// GET /api/schools/programs/:programId/grader-candidates
//
// Names and ids of people a program manager may assign as graders for this
// school. Students are not in the list. This is not a directory of every
// active Hub user. guardProgram: a student who cannot manage the school
// gets 403.

type Ctx = { params: Promise<{ programId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { programId } = await context.params;
  const guard = await guardProgram(programId);
  if (isGuard(guard)) return guard.response;

  const { data, error } = await fetchGraderCandidates(createAdminClient(), programId);
  if (error) return dbError(error, "Couldn't load grader candidates.");
  return json({ candidates: data });
}
