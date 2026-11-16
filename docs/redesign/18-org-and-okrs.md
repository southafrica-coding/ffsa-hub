# 18 · Org chart & OKRs — how the data is kept

Design: turns 40–42 in `FFSA Hub Redesign.dc.html` (40a/40b chart, 41a zoom into a team,
42a data map, 42b org changes, 42c monthly OKR update). Source of structure and objectives:
`uploads/FFSA_ Organisational Structure 2026.pdf`.

## The problem with what's live

Migration 099 stores the chart as a drawing: `org_nodes` (label, subtitle, headcount typed by
hand, optional `person_id`) and `org_edges`. Nothing else in the Hub reads it and it reads
nothing, so it drifts the moment someone joins a team in Training or a ministry ends.

## The model

The chart stores **only layout** (`org_layout`: team_id, x, y). Everything it draws is a read of:

| table | holds |
|---|---|
| `teams` | name, cluster (outward/inward/backbone), parent_id (sub-units like FFX), starts_on, ends_on, status |
| `team_memberships` | person_id, team_id, role_title, responsibilities text[], is_lead, share_pct, starts_on, ends_on, source (hub/training/events) |
| `reporting_lines` | team_id, leader_id, kind (oversees/integrates), starts_on, ends_on |
| `org_changes` | title, effective_on, status (draft/waiting/live), proposed_by, approved_by, steps jsonb |
| `okr_cycles` | year, review dates (Mar/Jun/Sep/Dec), reset date |
| `objectives` | cycle_id, team_id, direction (presence/formation/mission/multiplication/care), text, status (live/ended) |
| `key_results` | objective_id, owner_id, source (manual/linked), metric_key, target, state |
| `kr_checkins` | key_result_id, month, state, value, note, by_id |

Progress states are the document's five: complete · moving · in_progress · stuck · not_started.

## Rules

1. **Nothing is deleted.** Everything structural carries start/end dates; the chart can be
   rendered "as of" any date. Ending a team sets `ends_on`; its objectives become `ended`, not failed.
2. **Structure changes are change sets** (`org_changes`): proposed by a lead or Sample Person 3, approved by
   the Integrator (Sample Person 24), applied on `effective_on` by a nightly job. A set can't be approved while
   anyone it moves has no destination (42b). Nobody approves their own.
3. **Before approval a set lists its downstream effects**, computed, not typed: communications
   audiences that retire, recurring space bookings that end, outreach budgets needing a new owner,
   team-scoped `user_roles` that end, and the staff-count change (only people marked as leaving FFSA).
4. **Membership comes from where the work happens.** Training school-staff assignments write
   `team_memberships` with `source = 'training'` (read-only on the chart; edit in Training).
   Event teams do the same. Manual memberships are for everything else.
5. **Role descriptions live on the membership.** The person may suggest edits to their own;
   their team lead approves. Hub-derived lines (evaluator scope from Prayer Room, fleet manager from
   Vehicles, school staff from Training) render on the role card tagged with their module and are
   not editable there.
6. **Linked key results** read a live metric by `metric_key` (prayer-room coverage of 120h, sets
   with a lead, school completion, vehicles serviced on time, event registrations). The value is
   written nightly; the shepherd still picks the state. Manual KRs need the monthly check-in.
7. **Cadence:** monthly check-in per team by its OKR Shepherd; KRs editable only at a quarterly
   review (reason kept); direction and objectives only at the December reset. Anything else
   mid-year is a change set.
8. **Silence is a state.** A team with no check-in for the month shows LATE on the chart and in
   42c; a team with no shepherd says so. One yellow band per screen.

## What reads it

- Org chart (40/41) — includes zoom into a team: purpose, lead, reporting, shepherd, objective
  with KR owners, people with role, person panel (responsibilities, KRs owned, also serves on).
- Dashboard widgets: "my team's OKRs", "updates due".
- Communications: team audiences are rules over `team_memberships` (recount themselves).
- Space bookings: `ministries` (088) becomes a view over `teams`; `ministry_id` repoints.
- Outreach budgets: `owner_kinds` row for team → `teams.id`.
- Permissions: `user_roles.scope_type = 'team'` → `teams.id`; ends with the membership.
- Profiles/contacts: staff record lists current and past memberships.

## Admin editing (43a/43b)

Permission `org.admin`, held by **Sample Person 3 and Sample Person 24** (granted through Users & Roles like any other permission; neither approves a change set they proposed themselves). Everyone signed in can view the chart, zoom into any team and read every role description. Edit mode on the chart: click a table, every fact opens in one
inspector, each tagged with where it lives:

- **Typed here, saves now** — team name, cluster, purpose, sub-groups, role titles,
  responsibilities, share %, staff/volunteer, objective and KR wording, KR owner, shepherd,
  direction definitions, Missio structure, canvas layout. Written to the org tables; every edit
  goes to `org_edit_log` (who, when, field, before, after) and can be undone from History.
- **Change set, Sample Person 24 approves** — lead, reporting lines, creating/ending a team, adding or
  moving a person between teams (42b).
- **From another module ↗** — Training school staff and schools in session, Prayer Room
  seats/evaluators/coverage, Events teams, Vehicles fleet manager. The module wins; the chart
  links out and never stores a copy.
- **Worked out** — headcount, shared-person lines, monthly update state. Not editable.

Rewording a KR outside a quarterly review asks for a reason. Facts with no home today
(only in the PDF or master sheets): team purpose/cluster/sub-groups, leads, reporting lines,
LT seats, role titles and responsibilities, share %, staff vs volunteer, direction text,
objectives/KRs/owners/shepherds, manual KR progress, Missio structure, focus nations and
ministry expressions.

## Migration

One-time import from `org_nodes`/`org_edges`: team nodes → `teams`; person nodes → memberships,
matched to `people` by name with an unmatched queue (never silently dropped); `cross_team`
edges are discarded because shared service is now derived from people holding two memberships.
Then retire 099's tables.

## Build order

1. Schema + import (no UI change): org tables, OKR tables, import from 099, ministries view.
2. Chart reads the new tables: 40a light canvas, layers, highlight, drawer. Retire React Flow tree.
3. Zoom into a team (41a).
4. Edit mode + edit log (43b), `org.admin` for Sample Person 3 and Sample Person 24.
5. Change sets (42b) with the nightly apply job and downstream-effects query.
6. Monthly updates (42c), then linked KRs one module at a time (Prayer Room first).

Seed from the 2026 structure PDF content already in the design file (ORG_TEAMS, ORG_PEOPLE,
ORG_LEADERS, ORG_REPORTS, ORG_WORKS, ORG_DIR in the logic class). Woven is seeded as ended
(ends_on set), not left out, so history is right. KR wording beyond the Leadership team's three,
all KR owners and all progress numbers are design samples: seed objectives only, leave KRs for
the shepherds.

## Open

- Whether the staff count should include volunteers (Gitte is listed but "not FFSA staff").
- Which KRs get linked first; each needs a named metric in the owning module.
- Where Woven's people went (42b uses this as its example; real outcomes unknown).
