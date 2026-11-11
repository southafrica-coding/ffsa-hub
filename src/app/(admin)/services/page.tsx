import type { Metadata } from "next";
import { loadServicesForViewer } from "@/lib/departments";
import { audienceLabel, departmentNames, managingLabel, STAFF_LANGUAGE } from "@/lib/departments/data";
import { DepartmentLoadError, loadCachedDepartmentsIndex, sessionClient } from "@/lib/departments/load";
import { EmptyNote, PageHeading, ServiceCard } from "../departments/local-ui";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const supabase = await sessionClient();
  const [servicesResult, departmentsResult] = await Promise.all([
    loadServicesForViewer(supabase),
    loadCachedDepartmentsIndex(supabase),
  ]);
  if (servicesResult.kind === "error") {
    throw new DepartmentLoadError(
      servicesResult.error instanceof Error ? servicesResult.error.message : "Department data failed"
    );
  }
  // Forbidden and missing catalogues 404 in the layout, outside the loading boundary.
  const services = servicesResult.kind === "ok" ? servicesResult.data : [];
  const departments = departmentsResult.kind === "ok" ? departmentsResult.data : [];
  const names = departmentNames(departments);

  return (
    <div>
      <PageHeading context={STAFF_LANGUAGE} title="Services" />
      {departmentsResult.kind !== "ok" ? (
        <p className="px-5 pt-4 text-sm text-muted-foreground md:px-8">Couldn&apos;t load departments.</p>
      ) : null}
      <p className="max-w-prose px-5 py-4 text-sm text-muted-foreground md:px-8">
        Base-wide services. Each one is run by a staff ministry. You only see the ones your access can open.
      </p>
      {services.length === 0 ? (
        <EmptyNote title="No services for your access">
          Prayer room is open to every signed-in person. The other cards follow the module you already have.
        </EmptyNote>
      ) : (
        <div className="grid gap-3 px-5 pb-8 md:grid-cols-2 md:px-8">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              href={service.href}
              name={service.name}
              summary={service.summary}
              managing={managingLabel(service, names)}
              audience={audienceLabel(service.audience)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
