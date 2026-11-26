# Missio — design ↔ code reconciliation

Written 18 Nov 2026 against `origin/main` at `4912a1c4` (#610) and the open Missio branches
listed below. Design: `design/Missio.dc.html` (boards M1a–M14d). Spec: `20-missio-build-guide.md`.

**How this was checked:** file lists, migration headers and `CREATE TABLE` lines on each
branch. Nothing was run. Treat every "has" below as "the files exist" and read the code
before relying on behaviour.

## 1. What is on `main`

| Area | State | Where |
|---|---|---|
| Org wall: `organisations`, `org_staff_roles`, `org_people`, `has_org_role()` | merged (329) | `supabase/migrations/329_missio_org_phase0.sql` |
| Org switcher | merged | `src/components/missio/org-switcher*.tsx` |
| Missio shell (sidebar + phone drawer), Home, People directory, Add person | merged | `src/app/missio/*`, `src/components/missio/{shell,home,people-directory,add-person}.tsx` |
| People API | merged | `src/app/api/missio/{me,people,contacts/search}` |
| Fonts (Fraunces + Archivo), skin | merged, CSS modules | `src/components/missio/fonts.ts`, `*.module.css` |

Nav on `main`: Home · People · two "Soon" rows.

## 2. Open branches (unmerged, all touched 18 Nov)

| Branch | What it holds | Migration |
|---|---|---|
| `cursor/missio-house-churches-backend-d64c` | `house_churches`, `house_church_members` (role `leader`/`co_leader`/`member`, `started_at`/`ended_at`), `missio_import_review`, import script, API | 331 |
| `cursor/missio-house-churches-ui-dba3` | grid, house detail, review queue, people picker | — |
| `cursor/missio-connect-funnel-backend-0313` | connect submit, follow-up stages/leader/timeline, confirm-match (contains the house-churches backend too) | 331 (+ its own, check) |
| `cursor/missio-connect-follow-up-0cf7` | public `/connect/missio`, follow-up board, add-to-house, timeline sheet (contains house-churches UI too) | — |
| `feat/missio-volunteer-availability` | `missio_teams`, team leaders/members, `availability_requests/tokens/responses`, public `/serve/missio/[token]`, pastor board, nudge | 333 |
| `cursor/missio-ui-polish-942c` | copy/type polish, 6 commits behind `main` | — |

These overlap each other (the connect branches carry copies of the house-church files).
**Decide the merge order before anyone restyles them**, otherwise every redesign PR conflicts.
Suggested: house-churches backend → house-churches UI → connect backend → connect/follow-up UI
→ volunteers.

## 3. Where the design and the code use different words

| Design / guide says | Code says | Use |
|---|---|---|
| `houses`, `house_memberships` | `house_churches`, `house_church_members` | code |
| `person_id` | `contact_id` (people are `contacts` + `org_people`) | code |
| roles pastor/coach/leader/co-leader | org role `pastor` via `has_org_role`; leader/co-leader are **membership roles**, not logins yet | see §5 |
| tokens under `[data-org="missio"]` + Tailwind | CSS modules per component | keep modules; put the M1a values in one shared `tokens.module.css`/`:root` block for the Missio layout |
| `/w/<token>`, `/care`, `/f/<token>` | public routes live at `/connect/missio`, `/serve/missio/[token]` | follow the existing pattern: `/connect/missio`, `/serve/missio/…`, add `/care/missio`, `/welcome/missio/[token]`, `/feedback/missio/[token]` |
| `households` (new) | FFSA already has `households` (see `users.has_children` → `households.has_children`, branches `feat/shared-households`, `feat/household-members-child-policy`) | **reuse / extend, do not create a second households table** — check how it keys to contacts first |
| `consent_events` (new) | FFSA comms already has consent handling (`(admin)/consents`, `docs/redesign/11-communications.md`) | reuse the existing ledger, add Missio form names |
| WhatsApp via Meta Cloud API | `follow-up/whatsapp.ts` on the connect branch (likely `wa.me` links) | `wa.me` drafts stay for leader-sent messages; Cloud API is new work |

## 4. Design boards vs build state

| Boards | Screen | State |
|---|---|---|
| M1a–M1c | tokens, components, switcher, shell | shell + switcher merged; **restyle to M1a tokens, add tab bar** |
| M11a | Home v2, final menu | Home merged, **needs rework** |
| M2a–M2c | People, profile, journey | list merged; **profile + journey not built** |
| M3a–M3c, M4d, M4e | map, house page, grid, states | grid/detail on a branch; **map, coaches, signals not built** |
| M4c | import review queue | on a branch; restyle |
| M4a–M4b | weekly feedback + history | not built |
| M5a–M5c | connect card, follow-up, needs review | on branches; restyle, add consent line |
| M6a–M6c | availability, pastor grid, nudge | on a branch; restyle, add PCO blockouts later |
| M7a, M8a–M8d | teams, serving funnel → Planning Center | teams tables on the volunteers branch; **funnel + PCO not built** |
| M9a–M9c | Sundays (read-only PCO), service feedback | not built |
| M10a–M10c | leader + coach views, permissions | not built (only `pastor` exists) |
| M11b, M12d, M12e | multiply, next leaders, family tree | not built |
| M12a–M12c | placement pipeline + welcome messages | add-to-house exists on a branch; **pipeline + messages not built** |
| M11c, M11d, M13 | PCO settings, automatic messages, edit-where-sent | not built |
| M14a | households | see §3 |
| M14b–M14d | care, monthly report, Monday briefing | not built |

## 5. Decisions the code forces

1. **Leader / co-leader / coach logins.** Today only pastors pass the Missio wall. M10 needs
   `leader`, `co_leader`, `coach` as org roles (or derived from membership rows) plus RLS that
   scopes to "my house" / "my houses". This is the largest permission change; do it as its own
   PR with SQL tests like `supabase/tests/missio_org_phase0_rls.sql`.
2. **Coaches** are new: a `missio_coach_assignments` table (coach contact ↔ house or team).
3. **Migration numbers.** `main` is at 330. 331 and 333 are taken by open branches; assume
   332 is too. Pre-assign numbers per PR before starting (see `93-session-prompts.md` for why).
4. **Planning Center and WhatsApp Cloud API** need env vars and accounts before any code:
   `PCO_APP_ID`, `PCO_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_VERIFY_TOKEN` (names are proposals).
