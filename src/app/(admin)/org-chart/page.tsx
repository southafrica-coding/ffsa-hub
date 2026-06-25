import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getOrgChart } from "@/services/org-chart";
import { OrgChartFlow } from "./org-chart-flow";

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="page-eyebrow">Organisation · 2026</div>
          <h1 className="page-title">Org Chart</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
            {data?.chart.description ??
              "Rooted & Sent — the living structure of Fire & Fragrance South Africa. Click any team to expand its people; dotted lines show cross-team service."}
          </p>
        </div>
      </div>

      {data && data.nodes.length > 0 ? (
        <OrgChartFlow data={data} />
      ) : (
        <div
          className="flex h-[420px] flex-col items-center justify-center gap-2 rounded-xl text-center"
          style={{ border: "1px dashed #2C2823", background: "#100D0A" }}
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
  );
}
