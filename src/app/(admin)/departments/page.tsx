import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  clusterLabel,
  getDepartmentViewer,
  listDepartmentsForViewer,
} from "@/lib/departments/data";
import { STAFF_LANGUAGE } from "@/lib/departments/mocks";
import { requireSignedIn } from "@/lib/departments/session";
import { PageHeading, StackLink } from "./local-ui";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsIndexPage() {
  await requireSignedIn();
  const departments = listDepartmentsForViewer(getDepartmentViewer());
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
