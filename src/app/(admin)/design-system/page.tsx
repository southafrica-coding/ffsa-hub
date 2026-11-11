import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { DataTable } from "@/components/ffsa/department-ui";
import { ServiceCard } from "@/components/ffsa/department-ui";
import { MoneyCell } from "@/components/ffsa/money-cell";
import { MoneyTablePage, ServicePage } from "@/components/ffsa/templates";

/** Review gallery. Signed-in admins only. No shell item, so the title is the page metadata. */
export const metadata: Metadata = { title: "Design system" };
export default async function DesignSystemPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/design-system");

  const { userRoles } = await getSidebarAccess(supabase);
  const isAdmin = userRoles.includes("super_admin") || userRoles.includes("admin");
  if (!isAdmin) redirect("/home");

  return (
    <div className="pb-8">
      <ServicePage
        title="Design system"
        purpose="Samples of the pages, tables and figures used across the Hub."
        owner="Hub"
        steps={["Open a sample", "Check the type and the rules", "Say if something looks wrong"]}
        action={
          <button type="button" className="h-9 rounded-md bg-brand-black px-3 text-ui text-bg">
            Book
          </button>
        }
      />
      <div className="grid gap-3 px-5 md:grid-cols-2 md:px-8">
        <ServiceCard
          service={{
            id: "prayer-room",
            name: "Prayer room",
            summary: "Weekday sets, morning to night.",
            href: "/prayer-room",
            moduleId: "prayer-room",
            owners: [{ slug: "prayer", role: "owner" }],
            audience: "all_signed_in",
          }}
        />
      </div>
      <MoneyTablePage
        context="Finance"
        title="Budget"
        caption="Sample budget"
        columns={["Line", "Amount"]}
        rows={[
          { cells: ["Travel", null], cents: 1_245_000 },
          { cells: ["Refund", null], cents: -1_200 },
        ]}
        totalCents={1_243_800}
      />
      <DataTable
        caption="People"
        columns={["Name", "Role"]}
        rows={[["Test Leader A", "Prayer lead"]]}
      />
      <p className="px-5 py-4 text-ui">
        Sample amount <MoneyCell cents={1_245_000} />
      </p>
    </div>
  );
}
