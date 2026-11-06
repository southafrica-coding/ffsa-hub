import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getMinistry } from "@/services/ministries";
import { getOkrTeam, listCycles, listObjectives } from "@/services/okrs";
import { callerCanEditMinistryOkrs } from "@/lib/auth/check-okr-access";
import { buildOwnerPage, pickCycle } from "@/lib/mobile/okrs";
import type { OkrCycle, OkrObjective } from "@/types/okrs";

// GET /api/mobile/okrs/[ownerId]?cycle=<slug> — one group's OKRs for the
// phone app: the JSON twin of the website's /okrs/[ownerId] page.
//
// The id may be a staff ministry or an OKR-only team; both are looked up
// with the caller's client and whichever answers wins, as on the page.
// canEdit is the page's rule exactly: callerCanEditMinistryOkrs (admin, or
// an active leader of that ministry; a team is admin-only) AND the cycle is
// the current one. It only tells the app whether to offer a check-in — the
// existing POST /api/okrs/key-results/[id]/checkins asks again, and RLS
// decides in the end. Read-only, no service-role client.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const paramsSchema = z.object({ ownerId: z.string().uuid() });
const querySchema = z.object({
  cycle: z.string().trim().min(1).max(120).optional(),
});

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ ownerId: string }> }
) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return json({ error: "not_found" }, 404);
  const { ownerId } = params.data;

  const url = new URL(request.url);
  const query = querySchema.safeParse({ cycle: url.searchParams.get("cycle") ?? undefined });
  if (!query.success) return json({ error: "Invalid cycle" }, 400);

  const [{ data: ministry }, { data: team }, cyclesRes] = await Promise.all([
    getMinistry(supabase, ownerId),
    getOkrTeam(supabase, ownerId),
    listCycles(supabase),
  ]);
  const found = (ministry ?? team) as { name: string } | null;
  if (!found) return json({ error: "not_found" }, 404);
  const isTeam = !ministry && !!team;

  if (cyclesRes.error) return json({ error: cyclesRes.error.message }, 500);
  const cycles = (cyclesRes.data ?? []) as OkrCycle[];
  const cycle = pickCycle(cycles, query.data.cycle);
  if (!cycle) return json({ error: "no_cycle" }, 404);

  const [objectivesRes, canEditOwner] = await Promise.all([
    listObjectives(supabase, {
      cycleId: cycle.id,
      ministryId: isTeam ? undefined : ownerId,
      teamId: isTeam ? ownerId : undefined,
      scope: "ministry",
    }),
    // A team has no roster, so `null` asks the admin-only question.
    callerCanEditMinistryOkrs(supabase, user.id, isTeam ? null : ownerId),
  ]);
  if (objectivesRes.error) return json({ error: objectivesRes.error.message }, 500);

  return json(
    buildOwnerPage({
      owner: { id: ownerId, name: found.name, kind: isTeam ? "team" : "ministry" },
      cycles,
      cycle,
      objectives: (objectivesRes.data ?? []) as OkrObjective[],
      canEditOwner,
    })
  );
}
