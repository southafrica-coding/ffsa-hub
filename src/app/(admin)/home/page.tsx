import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadHomeForViewer, loadServicesForViewer } from "@/lib/departments";
import { clusterLabel, departmentNames, managingLabel, STAFF_LANGUAGE } from "@/lib/departments/data";
import { loadCachedDepartmentsIndex, sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { formatDayRange } from "@/lib/format/sa-time";
import type { HomeDashboard, RockStatus } from "@/lib/departments/ui-contract";
import { EmptyNote, PageHeading, SectionHeading, StackLink } from "../departments/local-ui";

export const metadata: Metadata = { title: "Home" };

const ROCK_LABEL: Record<RockStatus, string> = {
  on_track: "On track",
  off_track: "Off track",
  done: "Done",
};

export default async function HomePage() {
  const path = "/home";
  await requireSignedIn(path);
  const supabase = await sessionClient();
  const [homeResult, indexResult] = await Promise.all([
    loadHomeForViewer(supabase),
    loadCachedDepartmentsIndex(supabase),
  ]);
  const showAllDepartments = indexResult.kind === "ok" && indexResult.data.length > 0;
  if (homeResult.kind === "ok") {
    return <HomeBody home={homeResult.data} departmentsNote={false} showAllDepartments={showAllDepartments} />;
  }
  if (homeResult.kind === "unauthenticated") {
    settleViewerResult(homeResult, path);
  }
  if (homeResult.kind === "not_found") notFound();

  const services = settleViewerResult(await loadServicesForViewer(supabase), path);
  return (
    <HomeBody
      home={{ departments: [], services, rocksDue: [], okrCheckInsDue: [], viewerMemberships: [] }}
      departmentsNote
      showAllDepartments={showAllDepartments}
    />
  );
}

function HomeBody({
  home,
  departmentsNote,
  showAllDepartments,
}: {
  home: HomeDashboard;
  departmentsNote: boolean;
  showAllDepartments: boolean;
}) {
  const names = departmentNames(home.departments);

  return (
    <div>
      <PageHeading context={STAFF_LANGUAGE} title="Home" />

      <SectionHeading title="My departments" />
      {departmentsNote ? (
        <p className="px-5 py-4 text-sm text-muted-foreground md:px-8">Couldn&apos;t load departments.</p>
      ) : home.departments.length === 0 ? (
        <EmptyNote title="No department home yet">
          A home appears when you lead or serve on a staff ministry. Part-time ministries, Rooted
          Christian Academy and No Ministry do not get one.
        </EmptyNote>
      ) : (
        home.departments.map((department) => (
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
        ))
      )}
      {showAllDepartments ? (
        <p className="px-5 py-3 text-sm md:px-8">
          <Link href="/departments">All departments</Link>
        </p>
      ) : null}

      <SectionHeading title="Services you use" />
      {home.services.length === 0 ? (
        <EmptyNote title="You have not opened a service yet">
          The catalogue lists what your access can open. <Link href="/services">Browse services</Link>.
        </EmptyNote>
      ) : (
        <>
          {home.services.map((service) => (
            <StackLink
              key={service.id}
              href={service.href}
              title={service.name}
              meta={managingLabel(service, names)}
            />
          ))}
          <p className="px-5 py-3 text-sm md:px-8">
            <Link href="/services">All services you can open</Link>
          </p>
        </>
      )}

      <SectionHeading title="Rocks due" />
      {home.rocksDue.length === 0 ? (
        <EmptyNote title="No rocks due">
          Open rocks in your departments show here when they are overdue or due in the next two weeks.
        </EmptyNote>
      ) : (
        home.rocksDue.map((rock) => (
          <StackLink
            key={rock.id}
            href={`/departments/${rock.departmentSlug}?tab=rocks`}
            title={rock.title}
            meta={`${formatDayRange(rock.dueOn)} · ${ROCK_LABEL[rock.status]}`}
          />
        ))
      )}

      <SectionHeading title="OKR check-ins due" />
      {home.okrCheckInsDue.length === 0 ? (
        <EmptyNote title="No OKR check-ins due">
          Check-ins for your departments show here when the current cycle still needs one.
        </EmptyNote>
      ) : null}
    </div>
  );
}
