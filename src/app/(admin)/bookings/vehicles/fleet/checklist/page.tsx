import { createClient } from "@/lib/supabase/server";
import { requireFleet } from "@/lib/fleet/load";
import { defaultChecklist } from "@/lib/fleet/content";
import { checklistOrder, type Checklist } from "@/lib/fleet/rules";
import { getFleetSettings } from "@/services/fleet";
import { ChecklistScreen } from "./checklist-screen";
import { helpFor } from "./help";
import { normChecklist } from "./checklist-edit";

// Checklist (SPEC 5.9): every inspection point and which checks it belongs to; sort
// weekly/monthly and edit for Fleet managers. The Fleet app's checklistView / sortView.
export default async function FleetChecklistPage() {
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  const { data, error } = await getFleetSettings(supabase);
  if (error) throw new Error(error.message);
  const stored = (data?.checklist ?? null) as Checklist | null;
  // As the app: a saved checklist with sections is FFSA's own; otherwise the standard list.
  const saved = !!(stored && Array.isArray(stored.sections) && stored.sections.length);
  const standard = defaultChecklist();
  const checklist = normChecklist(saved ? stored! : standard);
  const help = helpFor([...checklistOrder(checklist), ...checklistOrder(standard)]);

  return <ChecklistScreen checklist={checklist} standard={standard} saved={saved} canManage={access.canManage} help={help} />;
}
