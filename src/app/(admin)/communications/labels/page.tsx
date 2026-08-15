import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { getLabels } from "@/services/labels";
import { Masthead } from "@/components/ffsa";
import { LabelsManager, type LabelRow } from "./labels-manager";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");

  // All labels (active + hidden), plus a per-label contact count in one round
  // trip — reduce the join table's label_id column in JS (same technique as
  // pickLeastUsedLabelColor), no dedicated view needed.
  const [{ data: labelData }, { data: joinRows }] = await Promise.all([
    getLabels(supabase),
    supabase.from("contact_labels").select("label_id"),
  ]);

  const counts: Record<string, number> = {};
  for (const row of (joinRows ?? []) as Array<{ label_id: string }>) {
    counts[row.label_id] = (counts[row.label_id] ?? 0) + 1;
  }

  const labels = (labelData ?? []) as LabelRow[];

  return (
    <div className="ffsa-screen">
      <Masthead context="Communications" title="Labels" />

      <div className="px-8 py-7">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Labels are your contact lists — a contact with label X receives
          campaigns sent to label X. Rename or recolour them, hide the ones you
          no longer use, or delete them permanently.
        </p>

        <LabelsManager initialLabels={labels} counts={counts} />
      </div>
    </div>
  );
}
