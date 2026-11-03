# FFSA Hub — roles × permissions (as read from the repo)

Prepared 1 Nov 2026 for the native-app plan. Source: `southafrica-coding/ffsa-hub` @ `main`, read through the GitHub connector (read-only). **Nothing was run against Supabase.**

Note: migration numbers 084/102/103/108/168/170/212/213/260/273/274 are cited from file names in the repo tree only (titles, not contents) — treat their details as unverified.

**Honest limits.** I read the migrations that *define* roles/permissions and the ones I could identify as bundle seeds (003, 014, 048, 081, 088, 089, 115, 125, 127, 131, 157, 183, 245, 248, 255, 263). The repo has ~270 migrations. Roles and bundles that were added or edited in migrations I did **not** read, or by an admin through the Roles screen after the fact, will be missing here. The *live* truth is in the database tables `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions`. Before the app is built, someone with read access should dump those tables (one read-only query) and diff against this file. Anything marked **(unverified)** is inferred.

## 1. How access is decided (plain English)

A person's access is the union of:
1. **Roles** they hold (`user_roles`), optionally scoped to a program/team/event (`scope_type`, `scope_id`).
2. **Role bundles** — each role can carry permissions (`role_permissions`). Since migration 089 a role is "a reusable bundle of permissions".
3. **Direct permissions** granted to the person (`user_permissions`), optionally scoped.

Two names to know:
- `super_admin` and `admin` are **bypass roles**: the web treats them as able to do almost everything. `admin` equals `super_admin` except for the Records Library (migrations 212/263).
- `self_service` is a baseline role every user is given (migration 115), carrying `bookings.view`, `vehicles.view`, `vehicles.request`.

### Where it is enforced
| Layer | What it does | Mobile consequence |
|---|---|---|
| **Postgres RLS** (policies using `is_admin()`, `has_role()`, `has_any_role()`, `has_permission(key)`, `has_permission_for(key, program_id)`, `is_outreach_finance_admin(team)`) | The real lock. Applies to any client using the user's JWT, including a phone. | Direct-from-app reads/writes are safe **only where RLS is correct**. |
| **TypeScript helpers** (`src/lib/api-auth.ts`, `require-permission.ts`, `sidebar-access.ts`, `finance-access.ts`, `lib/finance/outreach-access.ts`) | Decide which menu items/screens appear and gate API routes. They mirror RLS by hand. | The app needs its own copy of the *visibility* rules (small), but API routes still enforce on the server. |
| **Middleware** (`src/middleware.ts`) | Cookie session check + `users.is_active` check on every protected request. | See api-surface.md — this is the main thing that must change. |

### Known gaps (from the code, relevant to the app)
- `hasAnyPermission()` in `api-auth.ts` looks at **direct** grants only, so someone who holds a permission *via a role bundle* can be refused by an API route even though RLS would allow them. (Existing issue; the app would inherit it.)
- `api-auth.ts` lists role-name constants (`finance_admin`, `comms_admin`, `schools_admin`, …) and permission keys (`finance.manage`, `finance.write`, `schools.manage`) — I could not confirm every one of those keys exists in the `permissions` table. **(unverified)**
- `has_permission()` (migration 089) returns true for a role-derived grant **regardless of that role assignment's scope**; only `has_permission_for(key, program_id)` honours scope. Scoped grants therefore need care in the app UI.
- From earlier survey notes (`/workspace/ffsa-hub/repo-survey.md`): some API routes only check "signed in" (e.g. school-fees payments POST) and Xero connect has no auth. The app must not treat "the API will say no" as a safety net.

## 2. Roles seen in migrations

| Role (`roles.name`) | Display | Created in | System? | Bundle (permissions it carries) | Notes |
|---|---|---|---|---|---|
| `super_admin` | Super Admin | 003 | yes | none needed (bypass) | Full access; only role that can write `permissions`/`role_permissions` rows (014/089) |
| `admin` | Admin ("General Admin" display, 213) | 003 | yes | none needed (bypass) | Same as super_admin except Records Library; can grant permissions except `records_library.manage` (263) |
| `events_admin` | Events Admin | 003 | yes | none seen (relies on direct perms/role checks) | Web nav: Events module |
| `program_leader` | Program Leader | 003 | yes | `schools.manage`, `schools.assignable_as_contact` (125) | Web nav: Training |
| `team_leader` | Team Leader | 003 | yes | none seen | Web nav: Teams (hidden — placeholder page) |
| `staff` | Staff | 003 | yes | none seen | Web nav: Contacts |
| `student` | Student | 003 | yes | none seen | Mostly self access |
| `self_service` | Self-Service User | 003 | yes | `bookings.view`, `vehicles.view`, `vehicles.request` (115) | Every user has it |
| `ministry_leader` | Ministry Leader | 127 | no | `ministry.access`, `bookings.request` (131), `okrs.view` (183) | |
| `vehicle_manager` | Vehicle Manager | 131 | no | `vehicles.view`, `vehicles.approve`, `vehicles.manage` | |
| `booking_manager` | Space Booking Manager | 131 | no | `bookings.view`, `bookings.approve`, `bookings.manage` | |
| `leadership_team` | Leadership Team | 131 | no | `bookings.request` (131); `okrs.view`, `okrs.manage_cycles`, `okrs.manage_all` (183) | Auto-assigned by trigger from "Leadership Team" ministry membership. Sole role for the **Staff decisions** module (role-only, admin does not get it) |
| `legal_admin` | Legal / Compliance | 157 | no | `legal.access` | Read-only consents console |
| `finance_office` | Finance Office | 248 | no | `finance.donor_statements` only | Opens Finance menu but NOT outreach/school fees/Xero connection |
| `finance_admin` | (Finance Admin) | **not read** (unverified origin) | ? | ? | Referenced by RLS (`has_role('finance_admin')`) and `FINANCE_MANAGE_ROLES`. Per finance-meeting notes: Coreen's team |
| `comms_admin` | (Comms Admin) | **not read** | ? | ? | In `COMMS_MANAGE_ROLES`, nav gating |
| `mission_leader` | (Mission Leader) | **not read** | ? | ? | Nav gating (mission module hidden) |
| `schools_admin` | (Schools admin) | **not read** | ? | ? | In `SCHOOLS_MANAGE_ROLES` |

## 3. Permissions seen (key → module → seeded in)

| Module | Keys |
|---|---|
| contacts | `contacts.view/create/edit/delete` (014, older); `contacts.read/write/export/delete/dedup_review`, `labels.read/manage`, `imports.run` (048) |
| communications | `communications.send_announcements/send_emails/manage_templates` (014); `forms.read/manage`, `campaigns.read/draft/send`, `unsubscribes.manage` (048) |
| events | `events.view`, `events.create`, `events.manage_registrations`, `events.manage_attendance` (014) — **`events.manage_attendance` is what the staff door/check-in endpoint requires** |
| schools | `schools.view`, `schools.manage_enrollments`, `schools.view_applications`, `schools.approve_applications`, `schools.manage_attendance` (014); `schools.manage`, `schools.assignable_as_contact` (seeded in a migration I did not read; used by 125) |
| teams | `teams.view`, `teams.manage_members` |
| finance | `finance.view`, `finance.edit`, `finance.approve`, `finance.export` (014); `finance.donor_statements` (245); `finance.manage`/`finance.write` referenced in code (**unverified** they exist) |
| mission | `mission.view`, `mission.manage` |
| prayer-room | `prayer_room.manage` (014); more added in 084/102/108/168/170 etc. (not read) |
| bookings | `bookings.view`, `bookings.request`, `bookings.approve`, `bookings.manage` (088) |
| vehicles | `vehicles.view/request/approve/manage` (103, not read) |
| equipment | `equipment.view`, `equipment.request`, `equipment.operate`, `equipment.manage` (255) |
| okrs | `okrs.view`, `okrs.manage_cycles`, `okrs.manage_all` (183) |
| ministry | `ministry.access` (127) |
| legal | `legal.access` (157) |
| administration | `administration.manage_roles` (089; "seeded now, wired later") |
| others referenced, not read | `records_library.manage`, `brand_kit.view`, `org.view`, `accounting.settings`, `administration.*` |

Module id (the `permissions.module` column) matches the id in `src/config/modules.ts`; the sidebar shows a module if the user has *any* permission whose `module` matches (`permittedModules`).

## 4. Module visibility matrix (web sidebar rules — `src/config/modules.ts`)

Legend: ● always for any signed-in user · A = super_admin/admin · R = role listed · P = any permission in that module (direct; role bundles may not count, see gap above) · — hidden for everyone.

| Module | Route | Rule |
|---|---|---|
| Dashboard | /dashboard | ● |
| Contacts | /contacts | A, `staff`, or P(contacts) |
| Communications | /communications | A, `comms_admin`, or P(communications) |
| Events | /events | A, `events_admin`, or P(events) |
| Bookings | /bookings | A, or P(bookings) |
| Training (schools) | /schools | A, `program_leader`, or P(schools) |
| Teams | /teams | — (HIDDEN_FROM_NAV placeholder) |
| Org Chart | /org-chart | A, or P(org) |
| **Finance** | /finance | ● — **open to everyone** so anyone can run an outreach budget; the page shows other finance modules only to finance staff |
| Prayer Room | /prayer-room | ● |
| Mission | /mission | — (placeholder) |
| Ministries | /ministry | A, `ministry_leader`, or P(ministry) |
| OKRs | /okrs | ● |
| Staff decisions | /staff-decisions | **only** `leadership_team` (role-only) |
| Brand Kit | /brand-kit | A, or P(brand-kit) |
| Records Library | /records-library | `super_admin` only (admin only with `records_library.manage`) |
| Evangelism | /evangelism | — (placeholder) |
| Users | /users | A |
| Legal | /consents | A, `legal_admin`, or P(legal) |
| Roles | /roles | `super_admin` |
| Settings / Slack | /settings, /settings/slack | A |
| **Portal tabs** (always) | /profile, /my-events, /my-finance, /my-schools, /my-history (`/my-mission` hidden) | ● |

Phone tab bar on web today: **School · Finance · Prayer · Me** (`mobile-tab-bar.tsx`, frame 4d) — all open to every signed-in account.

## 5. Outreach finance specifics (the likely MVP)
- Read RLS on `outreach_teams`: `is_admin() OR has_role('finance_admin') OR has_permission('finance.view') OR has_permission('finance.edit')`, plus per-team access for team leaders/members (migrations 008, 015, 260, 273, 274 — "limited to own teams"; 273/274 not read). **(partially verified)**
- Writes: `is_admin() OR finance_admin OR finance.edit OR is_outreach_finance_admin(team)`.
- `outreach-receipts` storage bucket is **private**; file rules key on the uploader (comment in the receipts route).
