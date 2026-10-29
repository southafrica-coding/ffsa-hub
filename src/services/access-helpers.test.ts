import { describe, it, expect } from "vitest";
import { getVehicleAccess } from "@/services/vehicles";
import { getBookingAccess } from "@/services/bookings";
import { isPrayerRoomStaff } from "@/lib/auth/prayer-room-access";
import {
  createFakeSupabase,
  measure,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

function client(world: PermissionWorld, latencyMs = 0) {
  return createFakeSupabase({
    user: { id: "u1" },
    latencyMs,
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  });
}

const NONE = { isAdmin: false, canView: false, canRequest: false, canApprove: false, canManage: false };
const ALL = { isAdmin: true, canView: true, canRequest: true, canApprove: true, canManage: true };

describe("getVehicleAccess", () => {
  it.each<[string, PermissionWorld, typeof NONE]>([
    ["nobody", { roles: [], direct: [] }, NONE],
    ["admin", { roles: [{ id: "r", name: "admin" }], direct: [] }, ALL],
    [
      "self_service floor via bundle",
      {
        roles: [{ id: "ss", name: "self_service" }],
        direct: [],
        bundles: { ss: [{ module: "vehicles", key: "vehicles.view" }, { module: "vehicles", key: "vehicles.request" }] },
      },
      { ...NONE, canView: true, canRequest: true },
    ],
    [
      "direct approve + bundle view",
      {
        roles: [{ id: "ss", name: "self_service" }],
        direct: [{ module: "vehicles", key: "vehicles.approve" }],
        bundles: { ss: [{ module: "vehicles", key: "vehicles.view" }] },
      },
      { ...NONE, canView: true, canApprove: true },
    ],
    [
      "other modules don't leak in",
      { roles: [], direct: [{ module: "bookings", key: "bookings.manage" }] },
      NONE,
    ],
  ])("%s", async (_label, world, expected) => {
    expect(await getVehicleAccess(client(world).client, "u1")).toEqual(expected);
  });

  it("reads direct and bundle grants together", async () => {
    const f = client({ roles: [{ id: "ss", name: "self_service" }], direct: [] }, 20);
    const { roundTrips } = await measure(20, () => getVehicleAccess(f.client, "u1"));
    expect(roundTrips).toBeLessThanOrEqual(3);
  });
});

describe("getBookingAccess", () => {
  it.each<[string, PermissionWorld, typeof NONE]>([
    ["nobody", { roles: [], direct: [] }, NONE],
    ["super_admin", { roles: [{ id: "r", name: "super_admin" }], direct: [] }, ALL],
    [
      "approver via bundle, manager directly",
      {
        roles: [{ id: "bm", name: "booking_manager" }],
        direct: [{ module: "bookings", key: "bookings.manage" }],
        bundles: { bm: [{ module: "bookings", key: "bookings.approve" }] },
      },
      { ...NONE, canView: true, canApprove: true, canManage: true },
    ],
  ])("%s", async (_label, world, expected) => {
    expect(await getBookingAccess(client(world).client, "u1")).toEqual(expected);
  });
});

describe("isPrayerRoomStaff", () => {
  it.each<[string, PermissionWorld, boolean]>([
    ["nobody", { roles: [], direct: [] }, false],
    ["prayer_room_admin role", { roles: [{ id: "r", name: "prayer_room_admin" }], direct: [] }, true],
    ["admin role", { roles: [{ id: "r", name: "admin" }], direct: [] }, true],
    ["prayer_room.manage grant", { roles: [], direct: [{ module: "prayer-room", key: "prayer_room.manage" }] }, true],
    ["prayer_room.view only", { roles: [], direct: [{ module: "prayer-room", key: "prayer_room.view" }] }, false],
  ])("%s", async (_label, world, expected) => {
    expect(await isPrayerRoomStaff(client(world).client, "u1")).toBe(expected);
  });
});
