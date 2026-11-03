// Shared test fixtures for Bookings (not a test file). Placeholder data only.

import { personSchema, spaceBookingSchema, vehicleBookingSchema, type Person, type SpaceBooking, type VehicleBooking } from "../types";

export function spaceBooking(over: Record<string, unknown> = {}): SpaceBooking {
  return spaceBookingSchema.parse({
    id: "sb1",
    venue_id: "v1",
    series_id: null,
    title: "Youth night",
    booking_date: "2026-11-10",
    end_date: null,
    start_time: "18:00:00",
    end_time: "21:00:00",
    status: "pending",
    requested_by: "user-1",
    requester_name: "Jo Smit",
    venue: { id: "v1", name: "Main hall", building: "Base", requires_approval: true },
    ministry: null,
    ...over,
  });
}

export function vehicleBooking(over: Record<string, unknown> = {}): VehicleBooking {
  return vehicleBookingSchema.parse({
    id: "vb1",
    booking_name: "Airport run",
    point_person: "Jo",
    destination: "Cape Town airport",
    purpose: "airport_run",
    checkout_date: "2026-11-10",
    return_date: "2026-11-12",
    status: "pending",
    requested_by: "user-1",
    requester_name: "Jo Smit",
    assignments: [],
    drivers: [],
    ...over,
  });
}

export function person(over: Partial<Person> = {}): Person {
  return personSchema.parse({
    id: "p1",
    name: "Sam Driver",
    email: "sam@example.org",
    phone: null,
    country: "ZA",
    licence_expiry_date: "2028-01-01",
    licence_file_url: "on-file",
    passport_file_url: "on-file",
    base_driving_test_status: "not_required",
    ...over,
  });
}
