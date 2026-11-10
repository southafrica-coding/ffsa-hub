import type { ReactNode } from "react";
import Link from "next/link";
import { formatDayRange } from "@/lib/format/sa-time";
import { formatZarFromCents } from "@/lib/departments/money";
import { audienceLabel, clusterLabel, currentQuarter, resolveDepartment, serviceRoleLabel } from "@/lib/departments/data";
import { SERVICES, STAFF_LANGUAGE } from "@/lib/departments/mocks";
import { statusLabel, statusTone } from "@/lib/okrs/progress";
import type { DepartmentHome, RockStatus } from "@/types/departments";
import type { DepartmentTab } from "@/lib/departments/data";
import type { DepartmentTool } from "@/lib/departments/mocks";
import { StatusPill } from "@/components/ffsa";
import { DataTable, EmptyNote, LocalTabs, PageHeading, SectionHeading, StackLink } from "../local-ui";

const ROCK_LABEL: Record<RockStatus, string> = {
  on_track: "On track",
  off_track: "Off track",
  done: "Done",
};

export function DepartmentView({
  model,
  tab,
  tabs,
  tools,
}: {
  model: DepartmentHome;
  tab: DepartmentTab;
  tabs: { key: string; label: string; href: string }[];
  tools: DepartmentTool[];
}) {
  const { department, access } = model;
  const leaders = (model.people ?? []).filter((person) => person.capacity === "leader");
  const parent = department.parentSlug ? resolveDepartment(department.parentSlug) : null;
  const lead = leaders.length > 0 ? leaders.map((person) => person.name).join(", ") : "No lead is set";

  return (
    <div>
      <PageHeading context={`${STAFF_LANGUAGE} · ${clusterLabel(department.cluster)}`} title={department.name} />
      <LocalTabs label={department.name} tabs={tabs} active={tab} />
      {tab === "overview" && access.canSeeDepartmentDetail && (
        <>
          <p className="max-w-prose px-5 py-4 text-sm md:px-8">{department.purpose ?? "—"}</p>
          <dl className="grid gap-3 px-5 pb-6 md:px-8">
            <Fact label="Cluster" value={clusterLabel(department.cluster)} />
            <Fact label="People" value={String(department.memberCount)} />
            <Fact label="Lead" value={lead} />
            {parent && (
              <Fact
                label="Sits under"
                value={<Link href={`/departments/${parent.slug}`}>{parent.name}</Link>}
              />
            )}
            {(model.subMinistries ?? []).length > 0 && (
              <Fact
                label="Includes"
                value={(model.subMinistries ?? []).map((ministry) => ministry.name).join(", ")}
              />
            )}
          </dl>
        </>
      )}
      {tab === "people" && access.canSeeDepartmentDetail && <PeopleTab model={model} />}
      {tab === "okrs" && access.canSeeDepartmentDetail && <OkrsTab model={model} />}
      {tab === "rocks" && access.canSeeDepartmentDetail && <RocksTab model={model} />}
      {tab === "budget" && access.canSeeBudget && <BudgetTab model={model} />}
      {tab === "services" && access.canSeeDepartmentDetail && <ServicesTab model={model} />}
      {tab === "tools" && access.canSeeDepartmentDetail && <ToolsTab tools={tools} />}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PeopleTab({ model }: { model: DepartmentHome }) {
  const people = model.people ?? [];
  const listed = people.length;
  const rest = model.department.memberCount - listed;
  const showEmail = model.access.canSeePeopleEmails;
  return (
    <>
      <SectionHeading
        title="People"
        meta={`${model.department.memberCount} on this ministry`}
      />
      {listed === 0 ? (
        <EmptyNote title="No names are listed here yet">
          {model.department.memberCount === 1 ? "1 person is" : `${model.department.memberCount} people are`} on
          this ministry
          {(model.people ?? []).every((person) => person.capacity !== "leader") ? ", and no lead is set" : ""}. The live roster is on{" "}
          <Link href="/ministry">Ministries</Link>.
        </EmptyNote>
      ) : (
        <>
          <DataTable
            caption={`People on ${model.department.name}`}
            columns={showEmail ? ["Name", "Email", "Capacity", "Role"] : ["Name", "Capacity", "Role"]}
            rows={people.map((person) =>
              showEmail
                ? [person.name, person.email ?? "—", person.capacity === "leader" ? "Leader" : "Member", person.role ?? "—"]
                : [person.name, person.capacity === "leader" ? "Leader" : "Member", person.role ?? "—"]
            )}
          />
          <p className="px-5 py-4 text-sm text-muted-foreground md:px-8">
            {rest > 0
              ? `${rest} more ${rest === 1 ? "person is" : "people are"} on the roster. `
              : null}
            Open the live roster on <Link href="/ministry">Ministries</Link>.
          </p>
        </>
      )}
      {(model.subMinistries ?? []).map((ministry) => (
        <SubMinistryPeople key={ministry.slug} ministry={ministry} showEmail={showEmail} />
      ))}
    </>
  );
}

function SubMinistryPeople({
  ministry,
  showEmail,
}: {
  ministry: NonNullable<DepartmentHome["subMinistries"]>[number];
  showEmail: boolean;
}) {
  return (
    <>
      <SectionHeading title={ministry.name} meta="Sub-ministry" />
      <p className="max-w-prose px-5 py-3 text-sm text-muted-foreground md:px-8">{ministry.purpose}</p>
      {ministry.people.length === 0 ? (
        <EmptyNote title="No names are listed for this sub-ministry yet">
          {ministry.memberCount === 1 ? "1 person is" : `${ministry.memberCount} people are`} on{" "}
          {ministry.name}, and no lead is set. The live roster is on <Link href="/ministry">Ministries</Link>.
        </EmptyNote>
      ) : (
        <DataTable
          caption={`People on ${ministry.name}`}
          columns={showEmail ? ["Name", "Email", "Capacity", "Role"] : ["Name", "Capacity", "Role"]}
          rows={(ministry.people ?? []).map((person) =>
            showEmail
              ? [person.name, person.email ?? "—", person.capacity === "leader" ? "Leader" : "Member", person.role ?? "—"]
              : [person.name, person.capacity === "leader" ? "Leader" : "Member", person.role ?? "—"]
          )}
        />
      )}
    </>
  );
}

function OkrsTab({ model }: { model: DepartmentHome }) {
  const okrs = model.okrs;
  if (!okrs) return null;
  return (
    <>
      <SectionHeading title={`${okrs.cycleName} cycle`} meta="Current cycle" />
      <p className="px-5 py-3 text-sm md:px-8">
        <Link href={okrs.href}>Open the {okrs.cycleName} cycle</Link>
      </p>
      {okrs.objectives.length === 0 ? (
        <EmptyNote title={`Nothing entered for the ${okrs.cycleName} cycle yet`}>
          Ministry OKRs already live on the OKR wall. This tab only points at that cycle.
        </EmptyNote>
      ) : (
        <DataTable
          caption={`OKRs for ${model.department.name}`}
          columns={["Objective", "State"]}
          rows={okrs.objectives.flatMap((objective) =>
            objective.keyResults.map((result) => [
              result.label ? `${objective.title} · ${result.label}` : objective.title,
              <StatusPill key={result.id} tone={statusTone(result.status)}>
                {statusLabel(result.status)}
              </StatusPill>,
            ])
          )}
        />
      )}
    </>
  );
}

function RocksTab({ model }: { model: DepartmentHome }) {
  const rocks = model.rocks ?? [];
  return (
    <>
      <SectionHeading title="Rocks" meta={currentQuarter()} />
      {rocks.length === 0 ? (
        <EmptyNote title={`No rocks for ${currentQuarter()} yet`}>
          L10 rocks are not in the live schema. These rows will come from the rocks API.
        </EmptyNote>
      ) : (
        <DataTable
          caption={`Rocks for ${model.department.name}`}
          columns={["Rock", "Owner", "Status", "Due"]}
          rows={rocks.map((rock) => [
            rock.title,
            rock.owner,
            ROCK_LABEL[rock.status],
            rock.dueOn ? formatDayRange(rock.dueOn) : "No due date",
          ])}
        />
      )}
    </>
  );
}

function BudgetTab({ model }: { model: DepartmentHome }) {
  const budget = model.budget;
  if (!budget) return null;
  const links = budget.links ?? [];
  const budgetTotal = links.reduce((sum, link) => sum + link.budgetCents, 0);
  const spentTotal = links.reduce((sum, link) => sum + link.spentCents, 0);
  return (
    <>
      <SectionHeading title="Budget" meta="ZAR, South Africa" />
      {links.length === 0 ? (
        <EmptyNote title="No finance project linked" />
      ) : (
        <DataTable
          caption={`Budget for ${model.department.name}`}
          columns={["Project", "Budget", "Spent", "Left"]}
          rows={[
            ...links.map((link) => [
              link.name ?? "—",
              formatZarFromCents(link.budgetCents),
              formatZarFromCents(link.spentCents),
              formatZarFromCents(link.budgetCents - link.spentCents),
            ]),
            ["Total", formatZarFromCents(budgetTotal), formatZarFromCents(spentTotal), formatZarFromCents(budgetTotal - spentTotal)],
          ]}
        />
      )}
    </>
  );
}

function ServicesTab({ model }: { model: DepartmentHome }) {
  const services = (model.servicesRun ?? []).flatMap((run) => {
    const service = SERVICES.find((item) => item.id === run.serviceId);
    return service ? [{ ...service, role: run.role }] : [];
  });
  return (
    <>
      <SectionHeading title="Services we run" />
      {services.length === 0 ? (
        <EmptyNote title="This ministry does not run a base-wide service" />
      ) : (
        services.map((service) => (
          <StackLink
            key={service.id}
            href={service.href}
            title={service.name}
            meta={`${serviceRoleLabel(service.role)} · ${audienceLabel(service.audience)}`}
          />
        ))
      )}
    </>
  );
}

function ToolsTab({ tools }: { tools: DepartmentTool[] }) {
  return (
    <>
      <SectionHeading title="Tools" />
      {tools.length === 0 ? (
        <EmptyNote title="No tools for your access" />
      ) : (
        tools.map((item) => <StackLink key={item.href} title={item.label} href={item.href} />)
      )}
    </>
  );
}
