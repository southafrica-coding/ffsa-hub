import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import { getEnrolledStudentsForProgram } from "@/services/school-billing";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

const studentName = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.preferred_name || u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Unknown";

export default async function ProgramStudentsPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();

  const { data: program } = await getProgramById(supabase, programId);
  if (!program) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">Program not found.</p>
      </div>
    );
  }

  const { data: students } = await getEnrolledStudentsForProgram(
    supabase,
    programId
  );

  // How many phases each student is billed for.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: plans } = await (supabase as any)
    .from("student_billing_plans")
    .select("enrollment_id")
    .eq("program_id", programId);
  const phaseCount: Record<string, number> = {};
  for (const p of plans ?? []) {
    phaseCount[p.enrollment_id] = (phaseCount[p.enrollment_id] ?? 0) + 1;
  }

  type Student = {
    id: string;
    users: {
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
      nationality: string | null;
    };
  };
  const list = (students ?? []) as Student[];

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
        <h1 className="page-title">{program.name} — Student Billing</h1>
        <p className="text-sm text-muted-foreground">
          Each student is billed the full program by default. Open a student to
          set which phases they&apos;re doing — billing auto-trims to match.
        </p>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No active students enrolled in this program.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-4 divide-y">
            {list.map((s) => {
              const n = phaseCount[s.id] ?? 0;
              return (
                <Link
                  key={s.id}
                  href={`/finance/school-fees/${programId}/students/${s.id}`}
                  className="flex items-center justify-between py-3 hover:bg-muted/40 -mx-2 px-2 rounded"
                >
                  <div>
                    <p className="font-medium">{studentName(s.users)}</p>
                    {s.users.nationality && (
                      <p className="text-xs text-muted-foreground">
                        {s.users.nationality}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {n > 0 ? (
                      <Badge variant="secondary" className="text-xs">
                        {n} phase{n !== 1 ? "s" : ""} billed
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        no billing yet
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
