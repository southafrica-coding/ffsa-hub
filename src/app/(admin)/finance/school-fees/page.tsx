import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramsForBilling } from "@/services/school-billing";
import { getCountryTiers } from "@/services/school-fees";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
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

  const programRows = (programs ?? []) as ProgramRow[];

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Financial management"
        title="School Fees"
        actions={
          <>
            <GenerateInvoicesButton />
            <CountryTiersDialog
              initialTiers={
                (countryTiers ?? []) as Parameters<
                  typeof CountryTiersDialog
                >[0]["initialTiers"]
              }
            />
          </>
        }
      />

      <div className="px-8 py-7">
        <div className="border border-ink">
          <SectionBar
            title="Programs"
            meta="Pick a program to configure courses and student billing"
          />
          {programRows.length === 0 ? (
            <p className="px-6 py-10 text-center text-[13px] text-[color:var(--text-tertiary)]">
              No programs found. Create a program in Schools first.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Code</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead className="w-[130px] text-right">Courses</TableHead>
                  <TableHead className="w-[130px]">Status</TableHead>
                  <TableHead className="w-[90px] text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {programRows.map((program) => {
                  const courseCount = program.billing_courses?.length ?? 0;
                  return (
                    <TableRow key={program.id}>
                      <TableCell className="mono-label !text-[color:var(--text-secondary)]">
                        {program.code}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/finance/school-fees/${program.id}/billing`}
                          className="font-display text-[19px] font-black uppercase leading-none hover:text-electric"
                        >
                          {program.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="numeral text-[20px]">{courseCount}</span>
                        <span className="mono-label ml-2">
                          course{courseCount !== 1 ? "s" : ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={program.status === "active" ? "good" : "quiet"}>
                          {program.status}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/finance/school-fees/${program.id}/billing`}
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
