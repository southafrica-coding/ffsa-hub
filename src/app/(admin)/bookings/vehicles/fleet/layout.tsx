import { createClient } from "@/lib/supabase/server";
import { getFleetAccess } from "@/services/fleet";
import { FleetNav } from "./_components/fleet-nav";
import { LiveRefresh } from "./_components/live-refresh";

// Fleet: the FFSA Fleet app in the Hub (vehicles-module/HUB-PLAN.md). The tab strip
// and live updates show for people with Fleet access; Settings (today's "Manage
// fleet" list) also stays open to vehicle managers without it. Each page does its
// own access check.
export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = user ? await getFleetAccess(supabase, user.id) : null;

  return (
    <div className="ffsa-screen">
      {access?.canView && (
        <>
          <FleetNav />
          <LiveRefresh />
        </>
      )}
      {children}
    </div>
  );
}
