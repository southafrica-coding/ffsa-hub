import { NextResponse } from "next/server";
import { isOpened, openDepartment, serverError } from "@/lib/departments/http";
import { okrStatus } from "@/lib/departments/ui-contract";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "detail");
  if (!isOpened(opened)) return opened.response;
  const cycle = await opened.admin.from("okr_cycles").select("id, name, slug").eq("is_current", true).maybeSingle();
  if (cycle.error) return serverError(cycle.error);
  if (!cycle.data) return NextResponse.json({ cycle: null, objectives: [] });
  const current = cycle.data as { id: string; name: string; slug: string };
  const objectives = await opened.admin
    .from("okr_objectives")
    .select("id, title, position")
    .eq("cycle_id", current.id)
    .eq("staff_ministry_id", opened.department.id)
    .eq("scope", "ministry")
    .eq("is_archived", false);
  if (objectives.error) return serverError(objectives.error);
  const rows = (Array.isArray(objectives.data) ? objectives.data : []) as Array<{ id: string; title: string; position: number }>;
  const keyResults = rows.length
    ? await opened.admin
        .from("okr_key_results")
        .select("id, objective_id, description, current_status, position")
        .in("objective_id", rows.map((row) => row.id))
    : { data: [], error: null };
  if (keyResults.error) return serverError(keyResults.error);
  const results = (Array.isArray(keyResults.data) ? keyResults.data : []) as Array<{
    objective_id: string;
    description: string;
    current_status: string | null;
    position: number;
  }>;
  return NextResponse.json({
    cycle: current,
    objectives: rows
      .sort((a, b) => a.position - b.position)
      .map((objective) => ({
        title: objective.title,
        keyResults: results
          .filter((result) => result.objective_id === objective.id)
          .sort((a, b) => a.position - b.position)
          .map((result) => ({ description: result.description, status: okrStatus(result.current_status) })),
      })),
  });
}
