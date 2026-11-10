import type { Metadata } from "next";
import { audienceLabel, departmentNames, managingLabel, STAFF_LANGUAGE } from "@/lib/departments/data";
import { loadDepartmentApi } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import type { DepartmentSummary, HubService } from "@/lib/departments/ui-contract";
import { EmptyNote, PageHeading, ServiceCard } from "../departments/local-ui";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  await requireSignedIn();
  const [services, departments] = await Promise.all([
    loadDepartmentApi<HubService[]>("/api/services"),
    loadDepartmentApi<DepartmentSummary[]>("/api/departments"),
  ]);
  const names = departmentNames(departments);

  return (
    <div>
      <PageHeading context={STAFF_LANGUAGE} title="Services" />
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
