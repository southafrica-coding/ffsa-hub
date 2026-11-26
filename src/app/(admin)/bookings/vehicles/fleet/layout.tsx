import { createClient } from "@/lib/supabase/server";
import { getFleetAccess } from "@/services/fleet";
import { getVehicleAccess } from "@/services/vehicles";
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
  const [access, vehicles] = user
    ? await Promise.all([getFleetAccess(supabase, user.id), getVehicleAccess(supabase, user.id)])
    : [null, null];
  // The Calendar tab opens the booking board, which is the vehicles team's (it shows who
  // booked and why). Fleet view-only users don't get the tab (Jack's review of #698).
  const canBoard = !!vehicles && (vehicles.canApprove || vehicles.canManage);

  return (
    <div className="ffsa-screen">
      {access?.canView && (
        <>
          <FleetNav calendar={canBoard} />
          <LiveRefresh />
        </>
      )}
      {children}
    </div>
  );
}
