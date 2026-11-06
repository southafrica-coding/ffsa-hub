import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { listMinistries } from "@/services/ministries";
import { listCycles, listObjectives } from "@/services/okrs";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import { buildWall, pickCycle, toMobileCycle } from "@/lib/mobile/okrs";
import type { OkrCycle, OkrObjective } from "@/types/okrs";

// GET /api/mobile/okrs?cycle=<slug> — the OKR wall for the phone app.
//
// The website's /okrs is a server-rendered page, so this is its JSON twin:
// the same reads with the caller's own client (RLS decides what exists),
// the same access answers (admin / leadership / leads a ministry → the
// "not started" list; admin / leadership → cycles link), shaped by the same
// roll-ups in src/lib/okrs. Read-only. Open to any signed-in person, like
// the page. No service-role client.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const querySchema = z.object({
  cycle: z.string().trim().min(1).max(120).optional(),
});

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const url = new URL(request.url);
  const query = querySchema.safeParse({ cycle: url.searchParams.get("cycle") ?? undefined });
  if (!query.success) return json({ error: "Invalid cycle" }, 400);

  const cyclesRes = await listCycles(supabase);
  if (cyclesRes.error) return json({ error: cyclesRes.error.message }, 500);
  const cycles = (cyclesRes.data ?? []) as OkrCycle[];
  const cycle = pickCycle(cycles, query.data.cycle);

  if (!cycle) {
    return json({
      cycles: cycles.map(toMobileCycle),
      cycle: null,
      canManageCycles: false,
      seesGaps: false,
      totals: { groups: 0, groupsStarted: 0, objectives: 0, keyResults: 0, complete: 0, stuck: 0 },
      sections: [],
      showHeadings: false,
    });
  }

  const [objectivesRes, ministriesRes, isAdmin, onLeadership, ledMinistryIds] = await Promise.all([
    listObjectives(supabase, { cycleId: cycle.id, scope: "ministry" }),
    listMinistries(supabase),
    callerIsAdmin(supabase, user.id),
    isLeadershipTeam(supabase, user.id),
    getLedMinistryIds(supabase, user.id),
  ]);
  if (objectivesRes.error) return json({ error: objectivesRes.error.message }, 500);
  if (ministriesRes.error) return json({ error: ministriesRes.error.message }, 500);

  return json(
    buildWall({
      cycles,
      cycle,
      objectives: (objectivesRes.data ?? []) as OkrObjective[],
      ministries: ministriesRes.data ?? [],
      seesGaps: isAdmin || onLeadership || ledMinistryIds.length > 0,
      // Same answer as callerCanManageCycles, without asking twice.
      canManageCycles: isAdmin || onLeadership,
    })
  );
}
