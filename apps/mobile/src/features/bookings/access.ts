// What the person may see in Bookings, from GET /api/me. UX ONLY: the API
// routes and RLS decide, and a 403 still shows "not available on your
// account". Mirrors the web's gates:
//   - module access (requireModuleAccess): any permission in that module,
//     or admin;
//   - spaces (getBookingAccess): request = bookings.request|approve|manage,
//     approve = bookings.approve;
//   - vehicles (getVehicleAccess): request = vehicles.request|approve|manage,
//     approve = vehicles.approve|vehicles.manage (decision route);
//   - admins (super_admin, admin) pass everything.

import { isAdmin } from "@/features/shell/access";
import type { Me } from "@/lib/api";

export type BookingsAccess = {
  /** manage = may cancel anyone's booking (approve or manage, as the web's cancel rule). */
  spaces: { view: boolean; request: boolean; approve: boolean; manage: boolean };
  vehicles: { view: boolean; request: boolean; approve: boolean; manage: boolean };
  equipment: { view: boolean };
  /** Anything in Bookings at all (the web hub's requireAnyModuleAccess). */
  any: boolean;
  /** Something to approve here. */
  approver: boolean;
};

export function bookingsAccess(me: Me | null): BookingsAccess {
  const admin = isAdmin(me);
  const keys = new Set((me?.permissions ?? []).map((p) => p.key));
  const has = (k: string) => admin || keys.has(k);
  const inModule = (m: string) => admin || [...keys].some((k) => k.startsWith(`${m}.`));

  const spaces = {
    view: inModule("bookings"),
    request: has("bookings.request") || has("bookings.approve") || has("bookings.manage"),
    approve: has("bookings.approve"),
    manage: has("bookings.approve") || has("bookings.manage"),
  };
  const vehicles = {
    view: inModule("vehicles"),
    request: has("vehicles.request") || has("vehicles.approve") || has("vehicles.manage"),
    approve: has("vehicles.approve") || has("vehicles.manage"),
    manage: has("vehicles.approve") || has("vehicles.manage"),
  };
  const equipment = { view: inModule("equipment") };
  return {
    spaces,
    vehicles,
    equipment,
    any: spaces.view || vehicles.view || equipment.view,
    approver: spaces.approve || vehicles.approve,
  };
}
