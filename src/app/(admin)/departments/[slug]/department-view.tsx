import type { ReactNode } from "react";
import Link from "next/link";
import { formatDayRange } from "@/lib/format/sa-time";
import { formatZarFromCents } from "@/lib/departments/money";
import { audienceLabel, clusterLabel, serviceRoleLabel } from "@/lib/departments/data";
import { STAFF_LANGUAGE } from "@/lib/departments/mocks";
import type { DepartmentPageModel, DepartmentTab, OkrTone, RockStatus } from "@/types/departments";
import { DataTable, EmptyNote, LocalTabs, PageHeading, SectionHeading, StackLink } from "../local-ui";

const ROCK_LABEL: Record<RockStatus, string> = {
  on_track: "On track",
  off_track: "Off track",
  done: "Done",
};

const OKR_LABEL: Record<OkrTone, string> = {
  on_track: "On track",
  stuck: "Stuck",
  not_started: "Not started",
};

export function DepartmentView({ model, tab }: { model: DepartmentPageModel; tab: DepartmentTab }) {
  const { department } = model;
  const lead =
    model.leaders.length > 0
      ? model.leaders.map((person) => person.name).join(", ")
      : "No lead is set";

  return (
    <div>
      <PageHeading context={`${STAFF_LANGUAGE} · ${clusterLabel(department.cluster)}`} title={department.name} />
      <LocalTabs label={department.name} tabs={model.tabs} active={tab} />
      {tab === "overview" && (
        <>
          <p className="max-w-prose px-5 py-4 text-sm md:px-8">{department.purpose}</p>
          <dl className="grid gap-3 px-5 pb-6 md:px-8">
            <Fact label="Cluster" value={clusterLabel(department.cluster)} />
            <Fact label="People" value={String(department.memberCount)} />
            <Fact label="Lead" value={lead} />
            {model.parent && (
              <Fact
                label="Sits under"
                value={<Link href={`/departments/${model.parent.slug}`}>{model.parent.name}</Link>}
              />
            )}
            {model.subMinistries.length > 0 && (
              <Fact
                label="Includes"
                value={model.subMinistries.map((ministry) => ministry.name).join(", ")}
              />
            )}
          </dl>
        </>
      )}
      {tab === "people" && <PeopleTab model={model} />}
      {tab === "okrs" && <OkrsTab model={model} />}
      {tab === "rocks" && <RocksTab model={model} />}
      {tab === "budget" && <BudgetTab model={model} />}
      {tab === "services" && <ServicesTab model={model} />}
      {tab === "tools" && <ToolsTab model={model} />}
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

function PeopleTab({ model }: { model: DepartmentPageModel }) {
  const listed = model.people.length;
  const rest = model.department.memberCount - listed;
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
          {model.leaders.length === 0 ? ", and no lead is set" : ""}. The live roster is on{" "}
          <Link href="/ministry">Ministries</Link>.
        </EmptyNote>
      ) : (
        <>
          <DataTable
            caption={`People on ${model.department.name}`}
            columns={["Name", "Capacity", "Role"]}
            rows={model.people.map((person) => [
              person.name,
              person.capacity === "leader" ? "Leader" : "Member",
              person.role ?? "—",
            ])}
          />
          <p className="px-5 py-4 text-sm text-muted-foreground md:px-8">
            {rest > 0
              ? `${rest} more ${rest === 1 ? "person is" : "people are"} on the roster. `
              : null}
            Open the live roster on <Link href="/ministry">Ministries</Link>.
          </p>
        </>
      )}
      {model.subMinistries.map((ministry) => (
        <SubMinistryPeople key={ministry.slug} ministry={ministry} />
      ))}
    </>
  );
}

function SubMinistryPeople({ ministry }: { ministry: DepartmentPageModel["subMinistries"][number] }) {
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
          columns={["Name", "Capacity", "Role"]}
          rows={ministry.people.map((person) => [
            person.name,
            person.capacity === "leader" ? "Leader" : "Member",
            person.role ?? "—",
          ])}
        />
      )}
    </>
  );
}

function OkrsTab({ model }: { model: DepartmentPageModel }) {
  return (
    <>
      <SectionHeading title={`${model.okrs.cycleName} cycle`} meta="Current cycle" />
      <p className="px-5 py-3 text-sm md:px-8">
        <Link href={model.okrs.href}>Open the {model.okrs.cycleName} cycle</Link>
      </p>
      {model.okrs.objectives.length === 0 ? (
        <EmptyNote title={`Nothing entered for the ${model.okrs.cycleName} cycle yet`}>
          Ministry OKRs already live on the OKR wall. This tab only points at that cycle.
        </EmptyNote>
      ) : (
        <DataTable
          caption={`OKRs for ${model.department.name}`}
          columns={["Objective", "State"]}
          rows={model.okrs.objectives.map((objective) => [
            objective.title,
            OKR_LABEL[objective.tone],
          ])}
        />
      )}
    </>
  );
}

function RocksTab({ model }: { model: DepartmentPageModel }) {
  return (
    <>
      <SectionHeading title="Rocks" meta={model.quarter} />
      {model.rocks.length === 0 ? (
        <EmptyNote title={`No rocks for ${model.quarter} yet`}>
          L10 rocks are not in the live schema. These rows will come from the rocks API.
        </EmptyNote>
      ) : (
        <DataTable
          caption={`Rocks for ${model.department.name}`}
          columns={["Rock", "Owner", "Status", "Due"]}
          rows={model.rocks.map((rock) => [
            rock.title,
            rock.owner,
            ROCK_LABEL[rock.status],
            formatDayRange(rock.dueOn),
          ])}
        />
      )}
    </>
  );
}

function BudgetTab({ model }: { model: DepartmentPageModel }) {
  const project = model.budget.project;
  return (
    <>
      <SectionHeading title="Budget" meta="ZAR, South Africa" />
      {!project ? (
        <EmptyNote title="No finance project is linked yet">
          Amounts will be whole rands. Nothing is shown as R 0 while the link is missing.
        </EmptyNote>
      ) : (
        <>
          <p className="px-5 py-3 text-sm text-muted-foreground md:px-8">
            Placeholder rands until a finance project is linked. Not live Xero.
          </p>
          <DataTable
            caption={`Budget for ${model.department.name}`}
            columns={["Project", "Budget", "Spent", "Left"]}
            rows={[
              [
                project.name,
                formatZarFromCents(project.budgetCents),
                formatZarFromCents(project.spentCents),
                formatZarFromCents(project.budgetCents - project.spentCents),
              ],
            ]}
          />
        </>
      )}
    </>
  );
}

function ServicesTab({ model }: { model: DepartmentPageModel }) {
  return (
    <>
      <SectionHeading title="Services we run" />
      {model.services.length === 0 ? (
        <EmptyNote title="This ministry does not run a base-wide service" />
      ) : (
        model.services.map((service) =>
          service.canOpen ? (
            <StackLink
              key={service.id}
              href={service.href}
              title={service.name}
              meta={`${serviceRoleLabel(service.role)} · ${audienceLabel(service.audience)}`}
            />
          ) : (
            <div key={service.id} className="border-b px-5 py-3 md:px-8">
              <p className="font-medium">{service.name}</p>
              <p className="text-sm text-muted-foreground">
                {serviceRoleLabel(service.role)}. You cannot open this yet.
              </p>
            </div>
          )
        )
      )}
    </>
  );
}

function ToolsTab({ model }: { model: DepartmentPageModel }) {
  return (
    <>
      <SectionHeading title="Tools" />
      {model.tools.length === 0 ? (
        <EmptyNote title="No tools for your access" />
      ) : (
        model.tools.map((item) => <StackLink key={item.href} title={item.label} href={item.href} />)
      )}
    </>
  );
}
