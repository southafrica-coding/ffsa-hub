import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { loadOrgChart } from "@/services/org-chart";
import { canManageOrg } from "@/services/org-import";
import { OrgCanvas } from "./org-canvas";

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

  // Service role after the access check: rosters are RLS-scoped to their own
  // leaders, and the chart shows every team to everyone who can open it.
  const [data, canManage] = await Promise.all([loadOrgChart(createAdminClient()), canManageOrg(supabase)]);

  return (
    <div className="ffsa-screen">
      {data.model.teams.length > 0 ? (
        <OrgCanvas model={data.model} savedLayout={data.layout} canManage={canManage} />
      ) : (
        <div className="px-5 py-10 md:px-8">
          <p className="mono-label">No teams yet</p>
          <p className="mt-2 max-w-md text-[13px] text-[color:var(--text-secondary)]">
            The chart draws the staff ministries on the Ministry tab. Add one there and it appears here.
          </p>
        </div>
      )}
    </div>
  );
}
