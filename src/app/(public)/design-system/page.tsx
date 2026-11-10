import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { DataTable, ServiceCard } from "@/components/ffsa/department-ui";
import { MoneyCell } from "@/components/ffsa/money-cell";
import { MoneyTablePage, ServicePage } from "@/components/ffsa/templates";

/** Review gallery for the shared templates and the shell. Not a product page. */
export default async function DesignSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ collapsed?: string; groups?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <AdminSidebar
        userRoles={["super_admin"]}
        initials="FF"
        defaultCollapsed={params.collapsed === "1"}
        defaultGroupsClosed={params.groups === "closed"}
      />
      <div className="min-w-0 flex-1 pb-24 pt-16 md:pb-8 md:pt-0">
        <ServicePage
          title="Prayer room"
          purpose="A quiet hour in the prayer room, led by someone on the team."
          owner="Prayer"
          steps={["Pick a set", "Arrive a few minutes early", "Stay for the hour"]}
          action={
            <button type="button" className="h-9 rounded-md bg-brand-black px-3 text-ui text-bg">
              Book
            </button>
          }
        />
        <div className="grid gap-3 px-5 md:grid-cols-2 md:px-8">
          <ServiceCard
            href="/prayer-room"
            name="Prayer room"
            summary="Weekday sets, morning to night."
            owner="Prayer"
          />
        </div>
        <MoneyTablePage
          context="Finance"
          title="Budget"
          caption="Sample budget"
          columns={["Line", "Amount"]}
          rows={[
            { cells: ["Travel", null], cents: 1_245_000 },
            { cells: ["Refund", null], cents: -12_50 },
          ]}
          totalCents={1_243_750}
        />
        <DataTable
          caption="People"
          columns={["Name", "Role"]}
          rows={[["Amina", "Prayer lead"]]}
        />
        <p className="px-5 py-4 text-ui">
          Sample amount <MoneyCell cents={1_245_000} />
        </p>
      </div>
      <MobileTabBar />
    </div>
  );
}
