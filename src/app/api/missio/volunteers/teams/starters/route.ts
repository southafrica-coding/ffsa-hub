import { addStarterTeams } from "@/lib/missio/availability/service";
import { fromResult, withPastor } from "@/lib/missio/availability/http";

export const dynamic = "force-dynamic";

// POST /api/missio/volunteers/teams/starters
//
// Pastors only. Adds whichever of Sound, Worship, Kids, Welcome, Production
// and Hospitality the org doesn't have yet, and says which were already
// there. Only ever called from a pastor's tap on Volunteers.
export async function POST() {
  return withPastor("write", async (auth) => fromResult(await addStarterTeams(auth.supabase, auth.orgId)));
}
