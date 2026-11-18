# Training (staff)

Route: `app/(app)/training/` — a **tab**, shown only to Training staff (redesign board 48i).
Design: turns 48–49; spec `handoff/21-training-phone.md`, code map `handoff/22-training-code-map.md`.

**Who sees the tab** (`logic.ts` `hasTrainingAccess`, UX only; RLS decides what screens read):

| Role | How | Sections (top switcher) |
|---|---|---|
| Director | admin, or `schools.manage` with no scope | Today · Schools · Applicants · People |
| School leader | `program_leader`, or any scoped `schools.*` | Today · Students · Applicants · Grades |
| School staff | `GET /api/me` → `training.programStaff > 0` (migration 304) | Today · Students · Grades |
| Walking with | `GET /api/me` → `training.walkingWith > 0` (migration 334) | Today · My students · Grades |

`training` is `null` when the server can't read the ties (334 not applied, or an older
server): then only the Training module counts.

**Students** never use this tab: their side lives in My Schools (`features/schools`).

**What's here (T2):** the tab, the role switcher and each section's empty state, with
"Open Training on the website" where the web already has the screen. Content arrives per
slice: students + check-ins (T3), Today + badge (T4, `setTabBadge("training", n)`),
grades + applicants (T6), arrivals (T7).

Six tabs for Training staff: labels shrink to fit on the smallest phones (`minimumFontScale`
0.7, tested in `shell-logic.test.ts`). Everyone else keeps five.
