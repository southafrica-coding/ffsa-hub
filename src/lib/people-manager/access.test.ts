import { describe, expect, it } from "vitest";
import { canDecide, routeApprovers } from "./access";

describe("routeApprovers (421's leave_request_approvers)", () => {
  it("sends staff leave to every leader of the department", () => {
    expect(routeApprovers({ requesterId: "staff", leaderIds: ["ben", "mia"], adminIds: ["ada"] })).toEqual([
      { user_id: "ben", via: "leader" },
      { user_id: "mia", via: "leader" },
    ]);
  });

  it("sends a leader's leave to the other leaders only", () => {
    expect(routeApprovers({ requesterId: "mia", leaderIds: ["ben", "mia"], adminIds: ["ada"] })).toEqual([{ user_id: "ben", via: "leader" }]);
  });

  it("sends a sole leader's leave to the admins, never to themselves", () => {
    expect(routeApprovers({ requesterId: "gina", leaderIds: ["gina"], adminIds: ["ada", "gina"] })).toEqual([{ user_id: "ada", via: "admin" }]);
  });
});

describe("canDecide", () => {
  it("lets a leader or an admin decide someone else's request, never their own", () => {
    expect(canDecide({ requesterId: "s", userId: "ben", isLeaderOfDepartment: true, isAdmin: false })).toBe(true);
    expect(canDecide({ requesterId: "s", userId: "ada", isLeaderOfDepartment: false, isAdmin: true })).toBe(true);
    expect(canDecide({ requesterId: "s", userId: "zoe", isLeaderOfDepartment: false, isAdmin: false })).toBe(false);
    expect(canDecide({ requesterId: "ben", userId: "ben", isLeaderOfDepartment: true, isAdmin: true })).toBe(false);
    expect(canDecide({ requesterId: "s", userId: null, isLeaderOfDepartment: true, isAdmin: true })).toBe(false);
  });
});
