import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { canManageOrg, loadImportReview } from "@/services/org-import";
import { Masthead, MastheadAction } from "@/components/ffsa";
import { ImportQueue } from "./import-queue";

export const metadata = { title: "Org chart import · FFSA Hub" };

export default async function OrgImportPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  await requireModuleAccess(supabase, user.id, "org-chart");
  if (!(await canManageOrg(supabase))) redirect("/org-chart");

  const data = await loadImportReview(createAdminClient());

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Organisation · Org chart"
        title="Who is who"
        actions={<MastheadAction href="/org-chart">Back to the chart</MastheadAction>}
      />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        The old chart was a drawing: names typed into boxes, never linked to anyone in the
        Hub. Each name below needs a person before the new chart can read it from the
        rosters. Applying one adds them to that ministry&rsquo;s roster (or records the
        reporting line). Anyone already on the roster is left exactly as they are.
      </p>

      {"error" in data ? (
        <div className="px-5 py-6 md:px-8">
          <p className="mono-label">Not set up yet</p>
          <p className="mt-2 max-w-xl text-[13px] text-[color:var(--text-secondary)]">
            Apply migration{" "}
            <code className="font-mono text-ink">250_org_structure.sql</code> in the Supabase
            SQL editor. ({data.error})
          </p>
        </div>
      ) : (
        <ImportQueue rows={data.rows} people={data.people} ministries={data.ministries} />
      )}
    </div>
  );
}
