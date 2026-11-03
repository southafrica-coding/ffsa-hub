// Row shapes the bookings screens read, parsed tolerantly: unknown columns
// are ignored and optional ones may be null or missing, so the website can
// add columns without breaking installed apps. Mirrors the hand-written
// types in the web's src/services/bookings.ts and src/services/vehicles.ts
// (those tables aren't in the generated database.ts).

import { z } from "zod";

const str = z.string().nullish().transform((v) => v ?? null);
const bool = z.boolean().nullish().transform((v) => v ?? false);
/** PostgREST returns a to-one embed as an object, sometimes as a one-item array. */
function one<T extends z.ZodType>(schema: T) {
  return z
    .union([schema, z.array(schema)])
    .nullish()
    .transform((v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as z.infer<T> | null);
}

// ── Spaces ──────────────────────────────────────────────────────────────────

export const spaceStatusSchema = z.enum(["pending", "approved", "denied", "cancelled"]).catch("pending");
export type SpaceStatus = z.infer<typeof spaceStatusSchema>;

export const venueSchema = z.object({
  id: z.string(),
  name: z.string(),
  building: str,
  capacity: z.number().nullish().transform((v) => v ?? null),
  requires_approval: bool,
});
export type Venue = z.infer<typeof venueSchema>;

export const ministrySchema = z.object({ id: z.string(), name: z.string() });
export type Ministry = z.infer<typeof ministrySchema>;

export const spaceBookingSchema = z.object({
  id: z.string(),
  venue_id: z.string(),
  series_id: str,
  title: z.string(),
  description: str,
  point_person: str,
  booking_date: z.string(),
  end_date: str,
  start_time: str,
  end_time: str,
  setup_time: str,
  setdown_time: str,
  status: spaceStatusSchema,
  decision_note: str,
  requested_by: str,
  requester_name: str,
  decided_at: str,
  venue: one(z.object({ id: z.string(), name: z.string(), building: str, requires_approval: z.boolean().nullish() })),
  ministry: one(z.object({ id: z.string(), name: z.string() })),
});
export type SpaceBooking = z.infer<typeof spaceBookingSchema>;

/** One clash as POST /api/bookings describes it (lib/bookings/conflict-messages.ts). */
export const conflictSchema = z.object({
  date: z.string(),
  existingId: z.string(),
  existingTitle: z.string(),
  existingTime: str,
  occupiedUntil: str,
  who: str,
});
export type Conflict = z.infer<typeof conflictSchema>;

// ── Vehicles ────────────────────────────────────────────────────────────────

export const vehicleStatusSchema = z.enum(["pending", "approved", "denied", "cancelled", "completed"]).catch("pending");
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>;

export const vehicleSchema = z.object({
  id: z.string(),
  name: z.string(),
  vehicle_type: z.string().nullish().transform((v) => v ?? "car"),
  make_model: str,
  seats: z.number().nullish().transform((v) => v ?? null),
  registration_plate: str,
});
export type Vehicle = z.infer<typeof vehicleSchema>;

export const testStatusSchema = z.enum(["not_required", "pending", "passed", "failed"]).catch("not_required");

export const driverSchema = z.object({
  id: z.string(),
  user_id: str,
  name: z.string(),
  phone: str,
  is_first_time: bool,
  driving_test_status: testStatusSchema,
  license_file_url: str,
  passport_file_url: str,
});
export type Driver = z.infer<typeof driverSchema>;

export const vehicleBookingSchema = z.object({
  id: z.string(),
  booking_name: z.string(),
  point_person: str,
  destination: str,
  purpose: z.string().nullish().transform((v) => v ?? "ministry"),
  purpose_note: str,
  requester_name: str,
  requester_phone: str,
  num_people: z.number().nullish().transform((v) => v ?? null),
  checkout_date: z.string(),
  return_date: z.string(),
  status: vehicleStatusSchema,
  decision_note: str,
  notes: str,
  requested_by: str,
  decided_at: str,
  assignments: z
    .array(z.object({ vehicle: one(z.object({ id: z.string(), name: z.string(), registration_plate: str })) }))
    .nullish()
    .transform((v) => v ?? []),
  drivers: z.array(driverSchema).nullish().transform((v) => v ?? []),
});
export type VehicleBooking = z.infer<typeof vehicleBookingSchema>;

export const inspectionSchema = z.object({
  id: z.string(),
  kind: z.enum(["collection", "return"]),
  mileage: z.number().nullish().transform((v) => v ?? null),
  performed_at: z.string(),
  damage_panels: z.array(z.string()).nullish().transform((v) => v ?? []),
});
export type Inspection = z.infer<typeof inspectionSchema>;

/** A Hub user as GET /api/vehicles/people returns them (presence-only licence fields). */
export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: str,
  phone: str,
  country: str,
  licence_expiry_date: str,
  licence_file_url: str,
  passport_file_url: str,
  base_driving_test_status: testStatusSchema,
});
export type Person = z.infer<typeof personSchema>;
