// Test fixtures for Ministries (not a test file). Placeholder data only.

import type { MinistryDetail, MinistryList, MinistryListItem, RosterMember } from "../api";

export const MEDIA = "22222222-2222-4222-8222-222222222222";
export const KIDS = "33333333-3333-4333-8333-333333333333";
export const CAMS = "55555555-5555-4555-8555-555555555555";
export const SOUND = "66666666-6666-4666-8666-666666666666";

export function ministry(overrides: Partial<MinistryListItem> = {}): MinistryListItem {
  return { id: MEDIA, name: "Media", description: "Cameras and sound", isActive: true, ministryType: "main", peopleCount: 4, ...overrides };
}

export function ministryList(overrides: Partial<MinistryList> = {}): MinistryList {
  return { scope: "led", canCreate: false, ministries: [ministry()], ...overrides };
}

export function member(overrides: Partial<RosterMember> = {}): RosterMember {
  return {
    membershipId: "m1",
    userId: "p1",
    name: "Ann Lee",
    email: "ann@example.org",
    role: "member",
    status: "active",
    isPointLeader: false,
    categoryIds: [],
    pointLeaderCategoryIds: [],
    ...overrides,
  };
}

export function detail(overrides: Partial<MinistryDetail> = {}): MinistryDetail {
  return {
    ministry: { id: MEDIA, name: "Media", description: "Cameras and sound", isActive: true, ministryType: "main" },
    canManage: true,
    subcategories: [],
    roster: [member({ membershipId: "m1", name: "Ann Lee", role: "leader", isPointLeader: true }), member({ membershipId: "m2", userId: "p2", name: "Bo Dube", email: "bo@example.org" })],
    ...overrides,
  };
}
