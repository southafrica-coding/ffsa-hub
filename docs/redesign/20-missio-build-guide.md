# Missio — build guide

> **Read `96-missio-reconciliation.md` first.** This guide was written from the design side.
> Table names, routes and styling here are the design's vocabulary; the reconciliation maps
> them onto what is really on `main` and on the open Missio branches (for example
> `house_churches` / `house_church_members` keyed by `contact_id`, CSS modules under
> `src/components/missio/`, org roles via `has_org_role('missio', …)`). Where the two
> disagree, the code wins and this guide gets corrected.

The design is `docs/redesign/design/Missio.dc.html` (open it in a browser; newest turn at
the top). Board IDs below (M1a, M3a…) point to it.
Stack: Next.js · React · Tailwind · Supabase. Same app frame as FFSA; the org switcher
flips the skin.

---

## 1. Principles (read first)

1. **The Hub knows people; Planning Center runs Sundays.** The Hub collects, cares for and
   routes people. Planning Center (PC) stays the source of truth for teams, positions,
   scheduling, plans, songs and media. Never rebuild what PC already does — link to it
   ("Open in Planning Center").
2. **The Hub writes to PC in exactly two places:** adding a person to a team + position
   (serving inbox, M8c) and blockout dates (availability links, M6). Everything else from
   PC is read-only (Sundays, M9).
3. **Nobody is ever deleted.** People go inactive. Memberships end with a date.
4. **Membership is computed, not ticked:** a person is a member if they have ≥1 active
   house membership. Otherwise "Not in a house yet".
5. **Phone first.** 390px, no horizontal scroll at 360/390/430, 44px+ targets, tables become
   lists, modals become bottom sheets.
6. **Pastors place, leaders receive, coaches cover.** People are placed into houses by
   pastors, straight to the house leader. Coaches are pastoral covering for leaders — they
   see their houses and can change roles there, but no step ever waits on a coach.
7. **The person always knows where they are.** Every placement step sends them a message
   and their own next-steps page (M12b).
8. **Colour never carries meaning alone.** Every status chip has a word; every chart has an
   aria-label with the numbers.

---

## 2. Tokens (M1a)

Scope everything under `[data-org="missio"]` on `<html>`. FFSA keeps its own tokens.

```css
[data-org="missio"] {
  --frame:#1D2520; --frame-ink:#F3EFE4; --frame-ink-2:#A8B0A6; --terra-on-frame:#D7774F;
  --page:#F3F0E8; --panel:#FBF9F4; --subtle:#EEEADF; --rule:#DDD7C8; --rule-strong:#CFC8B6;
  --ink:#1C1B17; --ink-2:#5B574D; --ink-3:#6E685B; --link:#2F5D50;
  --terra:#B4532E; --terra-soft:#F6E4D9; --terra-ink:#8E3D1F;
  --olive:#4E6B4F; --olive-soft:#E3EADF; --olive-ink:#3F5940;
  --gold:#B98A2E;  --gold-soft:#F4EAD2;  --gold-ink:#7A5A17;
  --ok:#3F6E45; --warn:#94631A; --bad:#A3261B;
  --radius-xs:6px; --radius-sm:10px; --radius-md:14px; --radius-lg:20px;
  --shadow-1:0 1px 2px rgba(28,27,23,.05);
  --shadow-2:0 6px 18px rgba(28,27,23,.10);
  --shadow-3:0 -10px 40px rgba(28,27,23,.20);
}
```

Tailwind: map these as `missio-*` colours, radii and shadows (`theme.extend`), reading the
CSS variables so components don't need to know which org they're in.

Rules that matter: terracotta as **text** always uses `--terra-ink` (plain terracotta is 4.4:1
on paper — fails). Gold is never text. `--ink-3` replaced the old `#7A7466` (failed AA).

**Type:** Fraunces (opsz + wght, ~560) for titles and big numbers; Archivo for UI;
Roboto Mono for times/IDs only. Load via `next/font`, only inside the Missio layout.
Scale: display 44/48 (phone 34/38) · h1 32/38 (28/34) · h2 22/28 · h3 17/24 Archivo 600 ·
body 16/24 · small 14/20 · caption 12/16 · stat 56/40/28 tabular.

**Spacing:** 4-based — 4 8 12 16 20 24 32 40 56 80. Phone gutter 16, desktop 40.

**Motion:** press 120ms scale .98 · hover 160ms s1→s2 · sheet 260ms
`cubic-bezier(.2,.8,.2,1)` · load-in 320ms fade + 8px rise (Home and public pages only) ·
org switch 480ms wordmark beat. `prefers-reduced-motion` → 120ms fades only.

---

## 3. Components (M1b)

Button (primary / secondary / ghost / destructive / icon, 44 and 36) · Chip (status, always
with a word) · Tag (campus — outlined, never a colour) · Filter chip · Avatar (5 tints by
person id) + avatar stack · List row (64px) · Card (link cards lift on hover) · Field (label
above, 48px input, 16px text) · Segmented control incl. 3-way Yes/Maybe/No · Bottom sheet
(`<dialog>`, focus trap, Esc, returns focus; 480px right panel on desktop) · Timeline item ·
Empty / skeleton / error · Sync badge ("Synced to Planning Center · 2 min ago" /
"Not synced · Retry") · Read-only badge (M9) · "Open in Planning Center" button ·
People-dots (24 seats per house; M3a) · Sparkline (div bars + aria-label) · Toggle switch.

---

## 4. Screens → boards

| Area | Boards | Who |
|---|---|---|
| Frame, org switcher, menu | M1c, M11a | everyone |
| Home | M11a (supersedes M1d) | pastors |
| People, profile, journey | M2a–M2c | pastors, coaches |
| House churches map (interactive), phone map, house page | M3a–M3c | pastors, coaches |
| Weekly feedback form + history | M4a, M4b | leaders → coaches/pastors |
| Import review queue | M4c (`#M4`) | pastors |
| Grid view, states | M4d, M4e | — |
| Connect card (public), follow-up, needs review | M5a–M5c | newcomers → pastors |
| Volunteer availability (public), pastor grid, nudge | M6a–M6c | volunteers → pastors |
| Teams + serving sign-up (light) | M7a | — |
| Communications (light) | M7b | pastors |
| Serving funnel → PC | M8a–M8d | team managers |
| Sundays (read-only PC) + service feedback | M9a–M9c | everyone / service leaders |
| Leader view, coach view, permissions | M10a–M10c | leaders, coaches |
| Multiply a house | M11b | coach proposes, pastor confirms |
| Settings · Planning Center, automatic messages | M11c, M11d | pastors |
| Placement pipeline (pastor → leader → person) | M12a–M12c | pastors, leaders, the person |
| Next leaders (training pipeline) | M12d | leaders, coaches, pastors |
| House family tree + multiplication records | M12e | pastors, coaches |
| Edit messages where they're sent | M13a–b | pastors, leaders |
| Households | M14a | pastors, leaders |
| Care (public form + board) | M14b | anyone → pastors/leaders |
| Monthly report (WhatsApp) | M14c | leadership |
| Monday briefing (WhatsApp) | M14d | pastors, coaches |

Menu (final): Home · People · House churches · Follow-up · Care · Sundays · Volunteers · Teams · Report ·
(Later: Communications, Finance — "Soon", no pages) · Settings.
Phone tabs: Home · People · Houses · Sundays · Follow-up. Leaders: Home · My house · Sundays.
Coaches: Home · My houses · People · Sundays.

---

## 5. Data model (additions to what exists)

The People/house-church model and permissions are already built; these are the pieces the
designs add. All rows carry `org_id` and `created_by`.

- `coaches` — `person_id`, `active`.
- `coach_assignments` — `coach_id`, `target_type` (`house` | `team`), `target_id`,
  `starts_on`, `ends_on`. A house with no active row shows "No coach yet".
- `house_memberships` — existing; ensure `role` (`leader`|`co_leader`|`member`), `status`
  (`visiting`|`active`), `starts_on`, `ends_on`, `source` (import, follow-up, leader, multiply).
- `houses` — add `meeting_day`, `meeting_time`, `location` (nullable), `parent_house_id`
  (set by multiplication), `launched_on`.
- `households` — `name`, `main_contact_id`. `household_members` — `household_id`,
  `person_id`, `relationship` (`adult|spouse|child|other`). Children: `people.is_child`,
  first name + `birth_year` only, no contact fields, never messaged; visible to pastors, their
  house leaders and Kids church leads. House size = adults + kids shown separately; map dots
  count adults. Family messages go once to the main contact ("Hi Esther & Johan").
- `care_requests` — `person_id` (nullable = anonymous prayer), `kinds` (`prayer|talk|practical`),
  `text`, `privacy` (`pastors|pastors_leaders|house`), `urgent`, `source`
  (`care_form|connect_card|house_feedback|ministry_time|manual`), `status` (`new|on_it|done`),
  `taken_by`, `done_at`, `checkback_at` (done + 14 days). RLS enforces `privacy`.
  Urgent → WhatsApp the pastor on duty. Public form at `/care` (always on).
- `report_months` — frozen monthly snapshot of every KPI + `pastor_note`, `sent_at`.
  "Became members" = share of that month's connect cards with an active membership within
  90 days.
- `briefing_prefs` — per person: on/off, day/time (default Mon 07:30), included sections.
- `multiplications` — draft → launched; `from_house_id`, `new_house_id`, `launched_on`,
  `planned_by` (leader), `confirmed_by` (pastor), `before_count`, `stayed_count`, `went_count`.
- `multiplication_people` — **frozen snapshot at launch, never edited**: `multiplication_id`,
  `person_id`, `went` (bool), `role_before`, `role_after`, `house_after_id`. This answers
  "who went", "who became leaders from this split" and "who has Esther raised up".
- `leader_development` — `person_id`, `house_id`, `stage` (`spotted|training|ready|leading`),
  `trained_by`, `nominated_by`, `stage_changed_at`, `note`. Moving stages writes a
  `journey_event`. "Ready to multiply" = house ≥18 people **and** someone `ready` in it.
- `placements` — `person_id`, `house_id`, `placed_by` (pastor), `placed_at`,
  `leader_said_hi_at`, `address_sent_at`, `first_visit_at`, `joined_at`, `cant_make_it` log,
  `leader_deadline` (placed + 3 days). Drives the tracker (M12a) and the person's page (M12b).
  `joined_at` makes the house membership `active` and closes follow-up.
- `house_feedback` — `house_id`, `meeting_date`, `attendance`, `mood`
  (`hard|okay|good|great`), `prayer`, `notes`, `submitted_by`, `link_token_id`.
  A missed week has **no row** (charts draw a gap, never zero).
- `feedback_new_people` — names typed in the form → create `people` + follow-up `New`.
- `coach_checkins` — `coach_id`, `leader_person_id`, `date`, `kind`, `note`.
  Visible to that coach and pastors only.
- `connect_cards` — raw submission (name, phone E.164, visit_type, wants_house, prayer,
  `matched_person_id`, `match_status` `auto|needs_review|confirmed|rejected`).
- `followups` — `person_id`, `stage` (`new|contacted|visited|joined`), `assigned_to`,
  `stage_changed_at`. `joined` is set by a trigger when a house membership becomes active.
- `journey_events` — append-only: `person_id`, `type`, `ref_type`, `ref_id`, `actor`,
  `data`, `at`. Everything on the profile timeline is written here by the code that does the
  action; only `note` is typed by hand.
- `serving_signups` — form answers (teams, positions of interest, services, frequency,
  note), `status` (`new|placed|not_now`), `placed_team_pco_id`, `placed_position_pco_id`,
  `not_now_reason`, `revisit_on`.
- `availability_links` — per person token; `availability` — `person_id`, `service_date`,
  `answer` (`yes|maybe|no`), `note`, `pco_blockout_id`, `sync_status`.
- `service_feedback` — `pco_plan_id`, `pco_item_id` (nullable = general), `kind`
  (`well|improve`), `text`, `author`, `followup_person_id`, `followup_due`, `done_at`.
  Plus `service_debriefs` — `pco_plan_id`, `headcount`, `mood`, `summary`.
- `pco_links` — `person_id` ↔ `pco_person_id`, `match_method`, `linked_by`.
- `pco_cache` — cached service types, plans, items, plan people, teams, positions
  (JSON + `fetched_at`) so Sundays opens offline and survives PC outages.
- `sync_jobs` — every Hub → PC write: `kind`, `payload`, `status`, `attempts`, `last_error`.
- `message_templates` / `messages` — see §7.

**Row-level security** follows M10c exactly. Helper SQL functions: `is_pastor()`,
`coached_house_ids()`, `led_house_ids()`. Never rely on hiding things in the UI.

---

## 6. Planning Center

- **Auth:** start with a Personal Access Token (one church) stored server-side
  (Supabase secret). OAuth only if more orgs connect later.
- **Read (PC → Hub):** Services — service types, plans, plan items, plan times, plan
  people (status), teams, team positions; plan notes. Cache in `pco_cache`.
- **Write (Hub → PC):** (1) add person to a team + position; (2) create / delete blockouts.
  Queue every write in `sync_jobs`, retry every 15 min, surface failures in M11c.
- **Freshness:** PC webhooks → Next.js route handler (or Supabase Edge Function) → refresh
  the affected record. Nightly reconcile. On Sunday mornings, poll the day's plans every few
  minutes. Respect PC's rate limit (queue, don't burst).
- **Live mode (M9b):** follow PC's live controller if the team uses it; otherwise follow the
  clock against item lengths.
- **Matching:** phone (E.164) then email then name; uncertain → the M4c-style queue.
- **Verify before building:** confirm in PC's developer docs that the API allows creating
  team memberships with positions and person blockouts, which webhook events exist for
  plans/plan people, the live-controller endpoint, and the current rate limit. Test whether
  API-created placements trigger PC's own emails so volunteers aren't double-messaged.

---

## 7. WhatsApp (Meta Cloud API, direct)

- One Missio WhatsApp Business number on Meta's **WhatsApp Cloud API** (no Twilio).
- **Templates:** any business-initiated message (outside the 24-hour window since the
  person last wrote) must use a Meta-approved template. Each automatic message in M11d is
  one template; store Meta's template name, language and status (`draft|in_review|approved|rejected`)
  and read status back from Meta. Edits resubmit; the last approved version keeps sending.
- **Automatic messages (M11d):** weekly house feedback link · feedback reminder · welcome a
  newcomer · placed in a house (to the person, with their next-steps link) · someone is
  joining your house (to the leader, with a "said hi" link) · here's the address (after the
  leader says hi) · how was your first time? · availability link (monthly, 6 services) ·
  availability nudge · you've joined a team · service feedback link · coach check-in reminder ·
  care: received / pastor reply / check back · monthly report (leadership) · Monday briefing
  (pastors, coaches — personalised lines filled into one template).
- **Edit where it's sent (M13):** every send screen shows the message card with an
  "Edit message" button. Level 1 = a personal line for this one send (fills a `personal_note`
  variable built into every template — check Meta's variable-length rules). Level 2 = change
  the standard wording → resubmits the template; current approved wording keeps sending.
  Messages a leader sends from their own phone open a prefilled `wa.me` draft (free text).
  New permission `messages.edit` lets a non-pastor (e.g. comms) change standard wording.
- **Next-steps page** (`/w/<token>`): the person's house, day, time, leaders, what to expect,
  the 4-step tracker, and the address once released. Public, no login.
- **Rules:** max one automatic message per person per day; quiet hours 20:00–07:00 (except
  Sunday service feedback); STOP → mark `whatsapp_opt_out`, show under "left out" everywhere.
- **Webhook** from Meta → delivery/read status on `messages`; inbound replies stored for a
  future shared inbox. Log each send as a `journey_event`.
- Public links (feedback, availability) are per-person tokens, 7-day expiry for feedback,
  rotatable for availability. No login.

---

## 8. Build order

1. **Shell + tokens + components** (M1, M11a menu). Missio skin behind `data-org`.
2. **People + profile + journey** (M2) and `journey_events` everywhere from day one.
3. **House churches**: import queue (M4c) → house page (M3c) → grid (M4d) → map (M3a/b).
   Coaches + `coach_assignments`. States (M4e).
4. **Roles & RLS** (M10c), then leader and coach views (M10a/b). Phone-number sign-in.
5. **Connect card + follow-up** (M5) incl. needs-review matching.
6. **WhatsApp foundation** (§7) + automatic messages settings (M11d) — needed by 7–9.
7. **Weekly feedback** form + history (M4a/b).
8. **Planning Center link** (§6, M11c): auth, cache, people matching.
9. **Sundays read-only** (M9a/b) → **service feedback** (M9c).
10. **Serving funnel** (M8) → **volunteer availability + blockouts** (M6).
11. **Placement pipeline** (M12a–c) — needs WhatsApp (6) and houses (3).
12. **Households** (M14a) — ideally early, alongside People (step 2), since placement and
    multiplication use it.
13. **Care** (M14b), **Monday briefing** (M14d), **Monthly report** (M14c).
14. **Next leaders** (M12d), then **Multiply a house** (M11b) writing the frozen snapshot,
    then the **family tree** (M12e).
15. Later: Teams page (M7a), Communications composer (M7b), Finance.

---

## 8b. Consent (POPIA)

- Every public form (connect card, care form, serving sign-up) carries a plain consent line
  above the button, linking to a public "How we look after your details" page (`/privacy`).
  The care form uses an explicit tick box, because it can hold health and religious details.
- Store each consent as an append-only `consent_events` row: `person_id`, `form`, `text_version`,
  `channel` (`whatsapp`), `given_at`. Show it on the profile.
- Removal request → anonymise the person (name/phone/notes scrubbed, counts kept) and
  record it on the ledger. This is the one exception to "nobody is deleted".
- Have the consent wording and the privacy page checked by someone who knows POPIA.

## 9. Decisions (agreed 18 Nov 2026)

- Leaders **and co-leaders** see their own house's prayer needs.
- Coaches can change roles and end memberships in their houses; they are pastoral covering
  and never an approval step.
- Pastors place people into houses directly with the house leader; leaders can add visitors,
  which pastors then place.
- Availability links go out **monthly** and ask about the next **6** services.
- Multiplication is planned by the house leader with a pastor; the coach is kept informed.

## 10. Still open

- Whether house churches should also be mirrored into PC Groups (default: no).
- Default for "address after hello" (on for every house unless a pastor switches it off?).
- Real Sunday photography for Home and the connect card image slots (you are sourcing these).
