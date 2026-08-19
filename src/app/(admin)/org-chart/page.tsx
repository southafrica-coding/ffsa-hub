import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getOrgChart } from "@/services/org-chart";
import { OrgChartFlow } from "./org-chart-flow";
import { Masthead } from "@/components/ffsa";

export const metadata = { title: "Org Chart · FFSA Hub" };

export default async function OrgChartPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  // Gated until the module is dialed in — admins or holders of org.view.
  await requireModuleAccess(supabase, user.id, "org-chart");

  const data = await getOrgChart(supabase);

  return (
    <div className="ffsa-screen">
      <Masthead context="Organisation · 2026" title="Org Chart" />
      <div className="space-y-5 px-5 py-6 md:px-8">
        <p className="max-w-2xl text-[13px] text-[#55524A]">
          {data?.chart.description ??
            "Rooted & Sent — the living structure of Fire & Fragrance South Africa. Click any team to expand its people; dotted lines show cross-team service."}
        </p>

      {data && data.nodes.length > 0 ? (
        <OrgChartFlow data={data} />
      ) : (
        <div
          className="flex h-[420px] flex-col items-center justify-center gap-2 text-center"
          style={{ border: "1px dashed #C7C3B5", background: "#F4F2EA" }}
        >
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">
            No chart data yet
          </p>
          <p className="max-w-md text-[13px] text-[color:var(--text-secondary)]">
            Apply migration <code className="text-[color:var(--yellow)]">099_org_chart.sql</code>{" "}
            in the Supabase SQL editor to seed the FFSA 2026 structure.
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
