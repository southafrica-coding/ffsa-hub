import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchoolsCountScopes } from "@/lib/auth/schools-count-scopes";
import { getScopedPrograms } from "@/services/schools-analytics";
import { loadTrackPipeline, summariseAcceptedTrack } from "@/lib/schools/track-pipeline";

// Backs the "Who's doing which part" dashboard widget. Server half of the
// two-layer permission model: whatever a saved layout claims, a user only gets
// the schools `getSchoolsCountScopes` grants them. Aggregates only — no names
// or emails leave this route, so a view-level grant is enough.
//
// Only schools split into segments appear; every other school has nothing to
// say about a track.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { globalLevel, programLevels } = await getSchoolsCountScopes(supabase, user.id);
  const scopedIds = Object.keys(programLevels);
  if (globalLevel === null && scopedIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: programs, error } = await getScopedPrograms(
    supabase,
    globalLevel !== null ? null : scopedIds
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Read via the service-role client: applicant rows and enrolments are not
  // all readable under the viewer's own RLS (see the schools detail page).
  const admin = createAdminClient();
  const out = [];
  for (const program of (programs ?? []) as Array<{ id: string; name: string; code: string }>) {
    const { segments, people } = await loadTrackPipeline(admin, program.id);
    if (segments.length === 0) continue;
    out.push({
      id: program.id,
      name: program.name,
      code: program.code,
      ...summariseAcceptedTrack(people, segments),
    });
  }

  return NextResponse.json({ programs: out });
}
