// Server-side loading for Fleet pages: the access check, and everything the rules
// need (FleetData) read through the services and mapped in one go.

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFleetAccess,
  getFleetCoordinators,
  getFleetProviders,
  getFleetSettings,
  getFleetTimeLogs,
  getFleetTrips,
  getFleetVehicles,
  getFleetVisits,
  type FleetAccess,
} from "@/services/fleet";
import { defaultChecklist } from "./content";
import { fleetDataFromRows } from "./mapping";
import { addDays, todayInSA, weekStartOf, type FleetData } from "./rules";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Signed-in user with Fleet access, or a redirect. `manage` also requires fleet.manage. */
export async function requireFleet(supabase: Client, opts?: { manage?: boolean }) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getFleetAccess(supabase, user.id);
  if (!access.canView || (opts?.manage && !access.canManage)) redirect("/bookings/vehicles");
  return { user: user as { id: string; email?: string }, access };
}

export interface Coordinator {
  userId: string;
  name: string;
  phone: string;
  email: string;
  slackUserId: string | null;
}

/** The Vehicle Coordinator role holder(s), active first. */
export async function loadCoordinators(): Promise<Coordinator[]> {
  const admin = createAdminClient();
  const { data } = await getFleetCoordinators(admin);
  return ((data ?? []) as any[]) // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((r) => {
      const u = Array.isArray(r.user) ? r.user[0] : r.user;
      const p = u && (Array.isArray(u.person) ? u.person[0] : u.person);
      if (!u || !u.is_active) return null;
      const name = u.display_name || [p?.preferred_name || p?.first_name, p?.last_name].filter(Boolean).join(" ");
      return { userId: u.id, name: name || "", phone: p?.phone || "", email: u.email || "", slackUserId: u.slack_user_id || null };
    })
    .filter((c): c is Coordinator => !!c);
}

export interface FleetPageData {
  F: FleetData;
  /** Raw vehicle rows (with details), for fields the rules don't read (VIN, insurer, …). */
  vehicleRows: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  providers: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  coordinator: Coordinator | null;
  /** Everyone holding the role (normally one person). */
  coordinators: Coordinator[];
}

/** Everything the rules need, as of today in South Africa. */
export async function loadFleet(supabase: Client, today: string = todayInSA()): Promise<FleetPageData> {
  const [vehicles, trips, visits, settings, providers, timelog, coordinators] = await Promise.all([
    getFleetVehicles(supabase),
    getFleetTrips(supabase, addDays(today, -60)),
    getFleetVisits(supabase),
    getFleetSettings(supabase),
    getFleetProviders(supabase),
    getFleetTimeLogs(supabase, addDays(weekStartOf(today), -56)),
    loadCoordinators(),
  ]);
  for (const r of [vehicles, trips, visits, settings, providers, timelog]) if (r.error) throw new Error(r.error.message);
  const coordinator = coordinators[0] ?? null;
  const F = fleetDataFromRows({
    today,
    vehicles: vehicles.data ?? [],
    bookings: trips.data ?? [],
    visits: visits.data ?? [],
    settings: settings.data ?? null,
    providers: providers.data ?? [],
    timelog: timelog.data ?? [],
    coordinator,
    fallbackChecklist: defaultChecklist(),
  });
  return { F, vehicleRows: vehicles.data ?? [], providers: providers.data ?? [], coordinator, coordinators };
}

export type { FleetAccess };
