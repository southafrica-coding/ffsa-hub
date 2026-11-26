// Fleet on the booking board (Fleet part 5b, one calendar; Jack, 22 Nov 2026): for Fleet
// users, the board's calendar shows each vehicle's workshop visits, inspection days and
// clashes, and under it come Fleet's clashes and heads-ups (Move, move the visit, Let them
// know) and "Book a workshop visit" with the first free 48 hours. Everyone else sees the
// board as before. Server only.

import type { ReactNode } from "react";
import { loadFleet } from "@/lib/fleet/load";
import { inUse } from "@/lib/fleet/rules";
import { getFleetAccess } from "@/services/fleet";
import { buildVisitCtx, lastProvider } from "../[vehicleId]/visit-ctx";
import type { BookCtx } from "./calendar-client";
import { boardOverlay, clashItems, dueItems, gapChoices, missingServiceText, noneDueText, type BoardOverlay } from "./model";
import { BookSection, ClashSection, OutOfActionSection } from "./sections";
import { outOfAction } from "@/lib/fleet/out-of-action";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function boardFleet(supabase: Client, userId: string, from: string, days: number): Promise<{ overlay: BoardOverlay; panel: ReactNode } | null> {
  const access = await getFleetAccess(supabase, userId);
  if (!access.canView) return null;
  const { F, providers } = await loadFleet(supabase);
  const canWrite = access.canManage;
  const ctxs: Record<string, BookCtx> = canWrite
    ? Object.fromEntries(F.vehicles.filter(inUse).map((v) => [v.id, { ctx: buildVisitCtx(F, providers, v.id), provider: lastProvider(F, v.id, providers) }]))
    : {};
  const out = outOfAction(F);
  const panel = (
    <div className="border border-ink bg-white">
      <OutOfActionSection vehicles={out.vehicles} resume={out.resume} canWrite={canWrite} today={F.today} />
      <ClashSection items={clashItems(F)} ctxs={ctxs} canWrite={canWrite} />
      <BookSection due={dueItems(F)} noneDue={noneDueText()} missing={missingServiceText(F)} choices={gapChoices(F)} ctxs={ctxs} canWrite={canWrite} />
    </div>
  );
  return { overlay: boardOverlay(F, from, days), panel };
}
