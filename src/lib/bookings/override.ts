// Booking over a clash (space managers and admins). Kept apart from
// clash-guard.ts so client forms can share the limit without pulling in
// server code. The database enforces the same limit (migration 403).
export const OVERRIDE_REASON_MAX = 500;
