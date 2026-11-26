// Who may do what on a P&W L10 team (migration 416).
//
// The database decides: every read and write goes through the caller's
// session client, so 416's RLS applies. The flags come from 416's own
// helpers, called as the caller, so the API refuses a write with a clear
// 403 before RLS would, and the UI knows what to show.
//
//   canView / canEdit  l10_can_access_team: a team member, or an overseer
//                      (active admin, or a leader of the team's department).
//                      Reads and writes items; runs a meeting.
//   canManage          l10_can_manage_team: a team leader, or an overseer.
//                      Deletes rocks and measurables; rates anyone at a meeting.
//
// Everyone else (P&W members not on the team, Leadership Team readers,
// leaders of other departments) cannot see the team at all: 404.

export type L10Access = { canView: boolean; canEdit: boolean; canManage: boolean };

export function l10Access(canAccess: boolean, canManage: boolean): L10Access {
  return { canView: canAccess, canEdit: canAccess, canManage: canAccess && canManage };
}
