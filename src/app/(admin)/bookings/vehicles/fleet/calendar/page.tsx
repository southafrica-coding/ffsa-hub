import { redirect } from "next/navigation";
import { FLEET_CALENDAR } from "../_components/ui";

// One calendar (Fleet part 5d; Jack, 22 Nov 2026): Fleet's own calendar is gone. The booking
// board shows each vehicle's workshop visits, inspection days and clashes, with Fleet's
// clashes, out-of-action and "Book a workshop visit" under it. Old links land there, on the
// same dates (?start= becomes ?from=). The board checks who may see it.
export default async function FleetCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = Array.isArray(sp.start) ? sp.start[0] : sp.start;
  redirect(`${FLEET_CALENDAR}${s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `?from=${s}` : ""}`);
}
