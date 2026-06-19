import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPrograms } from "@/services/schools";
import { getAllProgramsSummary } from "@/services/school-fees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings2 } from "lucide-react";

export default async function SchoolFeesPage() {
  const supabase = await createClient();

  const [{ data: programs }, summaryByProgram] = await Promise.all([
    getPrograms(supabase),
    getAllProgramsSummary(supabase),
  ]);

  // Get fee structure counts per program
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: feeStructures } = await (supabase as any)
    .from("school_fee_structures")
    .select("program_id, tier");

  const structuresByProgram: Record<string, Set<string>> = {};
  for (const fs of feeStructures ?? []) {
    if (!structuresByProgram[fs.program_id]) {
      structuresByProgram[fs.program_id] = new Set();
    }
    structuresByProgram[fs.program_id].add(fs.tier);
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  return (
    <div className="space-y-6">
      <Link
        href="/finance"
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to Finance
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
          <h1 className="page-title">School Fees</h1>
        </div>
        <Link
          href="/finance/school-fees/billing-setup"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
        >
          <Settings2 className="h-4 w-4" />
          Billing Setup
        </Link>
      </div>

      {/* Programs Grid */}
      {!programs || programs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No programs found. Create a program in Schools first.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            programs as {
              id: string;
              name: string;
              code: string;
              status: string;
            }[]
          ).map((program) => {
            const tiers = structuresByProgram[program.id] ?? new Set();
            const summary = summaryByProgram[program.id];
            const hasAnyFees = summary && summary.totalStudents > 0;
            const pctCollected =
              hasAnyFees && summary.totalDue > 0
                ? (summary.totalPaid / summary.totalDue) * 100
                : 0;

            return (
              <Link
                key={program.id}
                href={`/finance/school-fees/${program.id}`}
              >
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {program.name}
                      </CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {program.code}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Tier badges */}
                    <div className="flex gap-1.5">
                      {["A", "B", "C"].map((t) => (
                        <Badge
                          key={t}
                          variant={tiers.has(t) ? "default" : "secondary"}
                          className={`text-xs ${
                            !tiers.has(t) ? "opacity-40" : ""
                          }`}
                        >
                          Tier {t}
                          {tiers.has(t) ? " ✓" : ""}
                        </Badge>
                      ))}
                    </div>

                    {hasAnyFees ? (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">
                              Students:
                            </span>{" "}
                            <span className="font-medium">
                              {summary.totalStudents}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Outstanding:
                            </span>{" "}
                            <span className="font-medium font-mono">
                              {formatCurrency(summary.totalOutstanding)}
                            </span>
                          </div>
                        </div>
                        {/* Collection progress */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Collected</span>
                            <span>{pctCollected.toFixed(0)}%</span>
                          </div>
                          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500 transition-all"
                              style={{
                                width: `${Math.min(pctCollected, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {tiers.size === 0
                          ? "No fee structures configured yet"
                          : "No students assigned fees yet"}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
