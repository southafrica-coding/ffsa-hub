import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadDepartmentsIndexForViewer } from "@/lib/departments";
import { clusterLabel, STAFF_LANGUAGE } from "@/lib/departments/data";
import { sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { PageHeading, StackLink } from "./local-ui";

export const metadata: Metadata = { title: "Departments" };
export const dynamic = "force-dynamic";

export default async function DepartmentsIndexPage() {
  const path = "/departments";
  await requireSignedIn(path);
  const departments = settleViewerResult(await loadDepartmentsIndexForViewer(await sessionClient()), path);
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
