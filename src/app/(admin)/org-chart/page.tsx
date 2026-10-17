import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getOrgChart } from "@/services/org-chart";
import { Masthead, MastheadAction } from "@/components/ffsa";
import { canManageOrg } from "@/services/org-import";
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

  const [data, canManage] = await Promise.all([getOrgChart(supabase), canManageOrg(supabase)]);

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Organisation · 2026"
        title="Org chart"
        actions={
          canManage ? <MastheadAction href="/org-chart/import">Who is who</MastheadAction> : undefined
        }
      />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        {data?.chart.description ??
          "Rooted & Sent — the living structure of Fire & Fragrance South Africa. Click any team to expand its people; dotted lines show cross-team service."}
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        {data && data.nodes.length > 0 ? (
          <OrgChartFlow data={data} />
        ) : (
          // The empty state was still painted in dark-theme hexes
          // (#100D0A on #2C2823) — invisible copy on the light page.
          <div className="flex h-[420px] flex-col items-center justify-center gap-2 border border-dashed border-rule-strong bg-bone text-center">
            <p className="mono-label">No chart data yet</p>
            <p className="max-w-md px-6 text-[13px] text-[color:var(--text-secondary)]">
              Apply migration{" "}
              <code className="font-mono text-ink">099_org_chart.sql</code> in
              the Supabase SQL editor to seed the FFSA 2026 structure.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
