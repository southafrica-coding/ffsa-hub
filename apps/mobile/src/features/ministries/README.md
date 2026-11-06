# Ministries (leaders and leadership)

Routes: `app/(app)/ministries/` — a hidden route of the signed-in tabs (not in `TABS`), opened from the Home "Ministries" shortcut or a Home feed item (`/ministry`, `/ministry/<id>`; `/ministry/staff/…` stays on the website).

| Screen | Route | Web equivalent |
|---|---|---|
| Ministries | `/ministries` | `/ministry` |
| Ministry team | `/ministries/[id]` | `/ministry/[id]` |

**Who sees it** (same rule as the web pages; the server decides, the app only hides):

| Person | List | Team (view) | Approve pending |
|---|---|---|---|
| admin / super_admin | every ministry | any | any |
| Leadership Team | every ministry | any | no |
| active leader of a ministry | the ones they lead | the ones they lead | the ones they lead |
| anyone else (incl. `ministry_leader` role with no led ministry) | 403 | 403 | 403 |

**Data.** The web pages read rosters with the service-role client, so the phone can't read those tables itself. Three bearer-aware endpoints on the website (`src/app/api/mobile/ministries/**`, contract in `src/lib/mobile/ministries.ts`) run the web pages' own checks (`callerIsAdmin`, `callerLeadsMinistry`, `getLedMinistryIds`, `isLeadershipTeam`) before any service-role read, and return only what the web pages show (name, email, role words, status, categories; no pickable-user list, no avatars):

- `GET /api/mobile/ministries/access` → `{ canView, scope }` (the Home shortcut's probe; caller's own client only)
- `GET /api/mobile/ministries` → `{ scope, canCreate, ministries[] }`
- `GET /api/mobile/ministries/[id]` → `{ ministry, canManage, subcategories[], roster[] }`

**The one action.** A manager (admin or this ministry's leader) can approve someone whose membership is pending, after a confirmation. It calls the website's existing `PATCH /api/ministries/[id]/members { membership_id }`, which checks again. The screen's single yellow band is "N people are waiting for you to approve them", shown only to managers with someone pending.

**Stays on the website** (via `openWebPage`): creating a ministry (admins), adding/removing people, leaders, point leaders, categories, editing the ministry, staff search and staff profiles.

**Offline.** The last good copy of each screen is kept with finance's `useCachedLoad` (encrypted store, per user). The shortcut's answer is remembered per user (`ffsa.ministries.access.v1:<userId>`); admins and Leadership Team are known from `/api/me` without asking.
