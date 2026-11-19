# Staff decisions (Leadership Team)

Routes: `app/(app)/staff-decisions/`. This is a hidden route of the signed-in tabs (it is not in `TABS`). It opens from the Home "Staff decisions" shortcut or from a Home feed item: `/staff-decisions`, and `/schools/<id>?tab=staff_decision` opens that school here. Other `/schools/…` pages stay on the website.

| Screen | Route | Web equivalent |
|---|---|---|
| Schools | `/staff-decisions` | `/staff-decisions` |
| One school's students | `/staff-decisions/[programId]` | `/schools/[programId]?tab=staff_decision` |

**Who sees it.** Only people with the `leadership_team` role. This is role-only, the same as the web's `ROLE_ONLY_MODULES`: **admin or super_admin alone does not get it.** The app reads the role from `GET /api/me` to hide the shortcut and gate the routes (`access.ts`). That is UX only. Every endpoint checks `isLeadershipTeam` again, and a 403 shows the calm "Leadership Team only" screen.

**Data.** The web pages read with the service-role client after `isLeadershipTeam`, so the phone can't read those tables itself. Two bearer-aware endpoints on the website (`src/app/api/mobile/staff-decisions/**`, contract in `src/lib/mobile/staff-decisions.ts`) run the same check before the same lib reads (`listLeadershipTrackPrograms`, `getLeadershipTrackProgram`, `loadStaffDecisionRows`):

- `GET /api/mobile/staff-decisions` returns `{ schools[]: { id, name, status, archived, total, yes, no, undecided } }`, newest first.
- `GET /api/mobile/staff-decisions/[programId]` returns `{ school, rows[], departmentOptions[] }`. It is 404 when the school isn't Leadership Track.

**Actions.** These go to the website's own endpoints, which check again:

- **Decide / Change** opens a bottom sheet with Yes / No and a note, then calls `POST /api/schools/staff-decisions`. A "no" needs a note: the sheet asks for one, and the API and database enforce the same rule.
- **Make staff** is offered after saving a yes for someone who has a Hub account and isn't staff yet. It is also a row button, the same as on the web. The person can pick an optional department (the active main ministries, the same list the web offers), then confirms in an alert. That calls `POST /api/schools/staff-decisions/make-staff`.

**The one yellow band.** On a school that isn't archived, the band reads "N students are still waiting on a staff decision". The list has no band, and neither does the web list.

**Stays on the website** (via `openWebPage`): Arrival, applications and the rest of the school page.

**Offline.** The last good copy of each screen is kept with finance's `useCachedLoad` (encrypted store, per user).

**Look (redesign R3, frames 12.1–12.6).** Both screens draw their own `LargeTitle` header (the stack has no native header). A school row is its name and one line of counts; a student row is the decision as a `StatusChip` (yes = green + check, no = quiet + cross, undecided = dashed), the note, who decided, and small buttons. The sheet's Yes / No is `components/ui.tsx` `ChoiceSegments`: the kit segmented control's look, but a radio group that starts with nothing chosen. A missing note for a no is said on the note field itself.
