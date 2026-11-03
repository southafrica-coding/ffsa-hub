// Plain reads, straight from Supabase as the signed-in person: the same
// queries the web pages run with the user's own client (getMyRequests,
// getMyVehicleRequests, getPendingRequests, getPendingVehicleBookings,
// getVenues, getMinistries, getVehicles …), so row-level security decides
// what comes back exactly as it does on the website. Nothing here writes.
//
// The bookings tables aren't in the generated database types (the web's
// services use an untyped client for them too), so rows are parsed with zod.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

import {
  inspectionSchema,
  ministrySchema,
  spaceBookingSchema,
  vehicleBookingSchema,
  vehicleSchema,
  venueSchema,
  type Inspection,
  type Ministry,
  type SpaceBooking,
  type Vehicle,
  type VehicleBooking,
  type Venue,
} from "./types";

export class DataError extends Error {
  name = "DataError";
}

type Db = Pick<SupabaseClient, "from">;
const db = () => supabase as unknown as Db;

const SPACE_SELECT = "*, venue:venues(id,name,building,requires_approval), ministry:ministries(id,name)";
const VEHICLE_SELECT =
  "*, assignments:vehicle_booking_assignments(vehicle:vehicles(id,name,registration_plate)), drivers:vehicle_booking_drivers(*)";

function rows<T>(schema: z.ZodType<T>, res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new DataError(`Couldn't load ${what}. Pull down to try again.`);
  const out: T[] = [];
  // One bad row shouldn't hide the rest.
  for (const r of Array.isArray(res.data) ? res.data : []) {
    const p = schema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

function single<T>(schema: z.ZodType<T>, res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T | null {
  if (res.error) {
    // PostgREST "no rows" (RLS hid it, or it's gone).
    if (res.error.code === "PGRST116") return null;
    throw new DataError(`Couldn't load ${what}. Pull down to try again.`);
  }
  const p = schema.safeParse(res.data);
  return p.success ? p.data : null;
}

export type MyBookings = { spaces: SpaceBooking[]; vehicles: VehicleBooking[] };

/** Everything I've requested. Each list is skipped when I can't open that module. */
export async function loadMine(userId: string, opts: { spaces: boolean; vehicles: boolean }, client: Db = db()): Promise<MyBookings> {
  const [s, v] = await Promise.all([
    opts.spaces
      ? client.from("venue_bookings").select(SPACE_SELECT).eq("requested_by", userId).order("booking_date", { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
    opts.vehicles
      ? client.from("vehicle_bookings").select(VEHICLE_SELECT).eq("requested_by", userId).order("checkout_date", { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  return { spaces: rows(spaceBookingSchema, s, "your space bookings"), vehicles: rows(vehicleBookingSchema, v, "your vehicle bookings") };
}

export type Pending = { spaces: SpaceBooking[]; vehicles: VehicleBooking[] };

/** The review queues, soonest first (only fetched for approvers). */
export async function loadPending(opts: { spaces: boolean; vehicles: boolean }, client: Db = db()): Promise<Pending> {
  const [s, v] = await Promise.all([
    opts.spaces
      ? client
          .from("venue_bookings")
          .select(SPACE_SELECT)
          .eq("status", "pending")
          .order("booking_date", { ascending: true })
          .order("start_time", { ascending: true, nullsFirst: true })
      : Promise.resolve({ data: [], error: null }),
    opts.vehicles
      ? client.from("vehicle_bookings").select(VEHICLE_SELECT).eq("status", "pending").order("checkout_date", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  return { spaces: rows(spaceBookingSchema, s, "space requests"), vehicles: rows(vehicleBookingSchema, v, "vehicle requests") };
}

export async function loadSpaceBooking(id: string, client: Db = db()): Promise<SpaceBooking | null> {
  return single(spaceBookingSchema, await client.from("venue_bookings").select(SPACE_SELECT).eq("id", id).single(), "this booking");
}

export type VehicleDetail = { booking: VehicleBooking; inspections: Inspection[] };

export async function loadVehicleBooking(id: string, client: Db = db()): Promise<VehicleDetail | null> {
  const [b, i] = await Promise.all([
    client.from("vehicle_bookings").select(VEHICLE_SELECT).eq("id", id).single(),
    client.from("vehicle_inspections").select("id,kind,mileage,performed_at,damage_panels").eq("vehicle_booking_id", id).order("performed_at", { ascending: true }),
  ]);
  const booking = single(vehicleBookingSchema, b, "this booking");
  if (!booking) return null;
  return { booking, inspections: rows(inspectionSchema, i, "the vehicle checks") };
}

export type SpaceOptions = { venues: Venue[]; ministries: Ministry[] };

/** Active venues and ministries, in the web's order (sort_order, then name). */
export async function loadSpaceOptions(client: Db = db()): Promise<SpaceOptions> {
  const [v, m] = await Promise.all([
    client.from("venues").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    client.from("ministries").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
  ]);
  return { venues: rows(venueSchema, v, "the spaces"), ministries: rows(ministrySchema, m, "the ministries") };
}

/** Active fleet, in the web's order. */
export async function loadVehicles(client: Db = db()): Promise<Vehicle[]> {
  const res = await client.from("vehicles").select("*").eq("status", "active").order("sort_order", { ascending: true }).order("name", { ascending: true });
  return rows(vehicleSchema, res, "the vehicles");
}
