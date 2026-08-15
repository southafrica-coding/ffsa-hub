import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import { getEnrolledStudentsForProgram } from "@/services/school-billing";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead, SectionBar, StatusPill, Initials } from "@/components/ffsa";

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
    <div className="ffsa-screen">
      <Masthead context={`School fees · ${program.name}`} title="Student Billing" />

      <div className="px-8 py-7">
        <div className="border border-ink">
          <SectionBar
            title="Students"
            meta={`${list.length} enrolled`}
          />
          <p className="border-b border-rule px-6 py-3 text-[13px] text-[color:var(--text-secondary)]">
            Each student is billed the full program by default. Open a student to
            set which phases they&apos;re doing — billing auto-trims to match.
          </p>
          {list.length === 0 ? (
            <p className="px-6 py-10 text-center text-[13px] text-[color:var(--text-tertiary)]">
              No active students enrolled in this program.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Nationality</TableHead>
                  <TableHead className="w-[180px]">Billing</TableHead>
                  <TableHead className="w-[90px] text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => {
                  const n = phaseCount[s.id] ?? 0;
                  const name = studentName(s.users);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Initials name={name} size={30} />
                          <Link
                            href={`/finance/school-fees/${programId}/students/${s.id}`}
                            className="font-medium hover:text-electric"
                          >
                            {name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px] text-[color:var(--text-secondary)]">
                        {s.users.nationality ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={n > 0 ? "good" : "quiet"}>
                          {n > 0 ? `${n} phase${n !== 1 ? "s" : ""} billed` : "No billing yet"}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/finance/school-fees/${programId}/students/${s.id}`}
                          className="inline-block border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
                        >
                          Open
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
