import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramsForBilling } from "@/services/school-billing";
import { getCountryTiers } from "@/services/school-fees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap } from "lucide-react";
import { CountryTiersDialog } from "./country-tiers-dialog";
import { GenerateInvoicesButton } from "./generate-invoices-button";

type ProgramRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  billing_courses: { id: string }[] | null;
};

export default async function SchoolFeesPage() {
  const supabase = await createClient();

  const [{ data: programs }, { data: countryTiers }] = await Promise.all([
    getProgramsForBilling(supabase),
    getCountryTiers(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
          <h1 className="page-title">School Fees</h1>
          <p className="text-sm text-muted-foreground">
            Pick a program to configure its courses and student billing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GenerateInvoicesButton />
          <CountryTiersDialog
            initialTiers={
              (countryTiers ?? []) as Parameters<
                typeof CountryTiersDialog
              >[0]["initialTiers"]
            }
          />
        </div>
      </div>

      {!programs || programs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No programs found. Create a program in Schools first.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(programs as ProgramRow[]).map((program) => {
            const courseCount = program.billing_courses?.length ?? 0;
            return (
              <Link
                key={program.id}
                href={`/finance/school-fees/${program.id}/billing`}
              >
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{program.name}</CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {program.code}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <GraduationCap className="h-4 w-4" />
                      {courseCount} course{courseCount !== 1 ? "s" : ""}
                    </p>
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
