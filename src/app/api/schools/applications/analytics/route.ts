import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { passesApplicationExpiry, APPLICATIONS_EXPIRED_MESSAGE } from "@/lib/auth/application-expiry";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const programId = searchParams.get("program_id");

  if (!programId) {
    return NextResponse.json(
      { error: "program_id is required" },
      { status: 400 }
    );
  }

  if (!(await passesApplicationExpiry(supabase, programId))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  // Fetch all responses for this program
  const { data: responses } = await supabase
    .from("application_responses")
    .select("id, status, submitted_at, reviewed_at")
    .eq("program_id", programId)
    .is("removed_at", null);

  // Fetch reference requests for these applications
  const applicationIds = (responses ?? []).map((r: { id: string }) => r.id);
  let refData: Array<{ application_id: string; status: string }> = [];
  if (applicationIds.length > 0) {
    const { data } = await (supabase as any)
      .from("reference_requests")
      .select("application_id, status")
      .in("application_id", applicationIds);
    refData = data ?? [];
  }

  const total = responses?.length ?? 0;

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  for (const r of responses ?? []) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }

  // Average time to decision (for reviewed applications)
  const reviewedResponses = (responses ?? []).filter(
    (r: any) => r.reviewed_at
  );
  let avgDaysToDecision: number | null = null;
  if (reviewedResponses.length > 0) {
    const totalDays = reviewedResponses.reduce(
      (sum: number, r: any) => {
        const submitted = new Date(r.submitted_at).getTime();
        const reviewed = new Date(r.reviewed_at).getTime();
        return sum + (reviewed - submitted) / (1000 * 60 * 60 * 24);
      },
      0
    );
    avgDaysToDecision = Math.round((totalDays / reviewedResponses.length) * 10) / 10;
  }

  // Reference completion rate
  const totalRefs = refData.length;
  const submittedRefs = refData.filter((r) => r.status === "submitted").length;
  const refCompletionRate =
    totalRefs > 0 ? Math.round((submittedRefs / totalRefs) * 100) : null;

  // Applications per week (last 8 weeks)
  const now = new Date();
  const weeklyData: Array<{ week: string; count: number }> = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const count = (responses ?? []).filter((r: { submitted_at: string }) => {
      const d = new Date(r.submitted_at);
      return d >= weekStart && d < weekEnd;
    }).length;

    weeklyData.push({
      week: weekStart.toLocaleDateString("en-ZA", {
        month: "short",
        day: "numeric",
      }),
      count,
    });
  }

  return NextResponse.json({
    total,
    statusCounts,
    avgDaysToDecision,
    refCompletionRate,
    totalRefs,
    submittedRefs,
    weeklyData,
  });
}
