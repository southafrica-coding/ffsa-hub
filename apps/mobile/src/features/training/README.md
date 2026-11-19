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

**Look (redesign R4, no mockup).** Built from the kit like the other tabs: `LargeTitleScrollView`
(eyebrow = day · scope, title = the section's title), the sections in the kit `SegmentedControl`
(at most four per role — see `SECTIONS` — so it fits at 360pt; labels wrap at large text rather
than scroll), rows in `ListGroup` (`GroupRow` for students and journey lines), statuses as
`StatusChip`s with a word and an icon (Needs care · No check-in · On track · Arriving), empty
and no-access as `EmptyState`, `SkeletonList` while loading, `LoadError` with Try again, and the
kit `Freshness` note when a saved copy is showing. Today's band and the care band are the kit
`NeedsYouBand` (one per screen). A student's record and the check-in form draw their own back
chevron ("Training", then the student's name); the stack has no native header. The two check-in
notes still look nothing alike: the note they read has a yellow rule, the staff-only note is an
ink panel. `strings.switcherLabel` is no longer spoken (the kit segmented control has no group
label); each tab still reads its name and selected state.
