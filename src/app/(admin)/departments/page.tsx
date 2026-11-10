import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clusterLabel, STAFF_LANGUAGE } from "@/lib/departments/data";
import { loadDepartmentApi } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import type { DepartmentSummary } from "@/lib/departments/ui-contract";
import { PageHeading, StackLink } from "./local-ui";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsIndexPage() {
  await requireSignedIn();
  const departments = await loadDepartmentApi<DepartmentSummary[]>("/api/departments");
  if (departments.length === 0) notFound();

  return (
    <div>
      <PageHeading context={STAFF_LANGUAGE} title="Departments" />
      {departments.map((department) => (
        <StackLink
          key={department.slug}
          href={`/departments/${department.slug}`}
          title={department.name}
          meta={
            department.budgetOnly
              ? `${clusterLabel(department.cluster)} · Budget only`
              : clusterLabel(department.cluster)
          }
        />
      ))}
    </div>
  );
}
