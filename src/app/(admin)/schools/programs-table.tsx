"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProgramActions } from "./program-actions";

type ProgramRow = {
  id: string;
  name: string;
  code: string;
  credit_hours: number;
  status: string;
  created_at: string;
  billing_courses?: { id: string }[];
};

export function ProgramsTable({
  programs,
  statusFilter,
}: {
  programs: ProgramRow[];
  statusFilter: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleFilterChange(status: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", status);
    router.push(`/schools?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={statusFilter === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("active")}
        >
          Active
        </Button>
        <Button
          variant={statusFilter === "archived" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("archived")}
        >
          Archived
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Program</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Credit Hours</TableHead>
              <TableHead>Courses</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {programs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  {statusFilter === "archived"
                    ? "No archived programs."
                    : "No programs yet. Create your first program to get started."}
                </TableCell>
              </TableRow>
            ) : (
              programs.map((program) => (
                <TableRow key={program.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/schools/${program.id}`}
                      className="hover:underline text-primary"
                    >
                      {program.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {program.code}
                  </TableCell>
                  <TableCell>{program.credit_hours}</TableCell>
                  <TableCell>{program.billing_courses?.length ?? 0}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        program.status === "active" ? "default" : "secondary"
                      }
                    >
                      {program.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(program.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <ProgramActions program={program} variant="icon" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
