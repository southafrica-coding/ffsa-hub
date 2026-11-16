# Org chart & OKRs — reconciliation

What `18-org-and-okrs.md` proposes, against what the Hub already runs.
Verified in migrations and code on `main` @ `78d6565`, and with read-only row
counts against production, 2026-10-18.

Doc 18 reads as a greenfield design: it says the only thing live is migration
099's drawing. That was true of the checkout the design session saw. It is not
true of `main`. Two systems it would create already exist and are in use:

- **Teams and memberships** exist as `staff_ministries` (126) and
  `staff_ministry_members`: 17 ministries, 151 memberships, leaders, point
  leaders, sub-categories, main / part-time, a department sync trigger, a
  "No Ministry" trigger, and the `leadership_team` role trigger that the OKR
  policies key off.
- **OKRs** exist as `okr_cycles` / `okr_objectives` / `okr_key_results` /
  `okr_checkins` (182), with permissions (183), an edit-history log
  `okr_events` (197), and a live `/okrs` module.

Creating doc 18's `teams`, `team_memberships`, `objectives`, `key_results` and
`kr_checkins` beside them would give the Hub two rosters and two OKR stores
that drift apart — exactly the problem doc 18 exists to fix for the chart.

**What doc 18 gets right, and what is genuinely missing**, is the part that
makes the chart readable from data: start and end dates on everything
structural, clusters, reporting lines, change sets, an edit log for structure,
a layout table, and the one-time import of the 099 drawing with an unmatched
queue. That is what step H should build — onto the existing tables.

---

## The mapping

| Doc 18 proposes | Already exists as | Verdict |
|---|---|---|
| `teams` | `staff_ministries` (126) + `ministry_type` (195) | **Extend.** Add `cluster`, `parent_id`, `purpose`, `starts_on`, `ends_on`. Do not create `teams`. |
| `teams.parent_id` (sub-units like FFX) | `staff_ministry_subcategories` (128) + multi-category join (205) | **Both stay** — see "Sub-units" below. |
| `team_memberships` | `staff_ministry_members` (126/129/205) | **Extend.** Add `role_title`, `responsibilities`, `share_pct`, `staff_kind`, `starts_on`, `ends_on`, `source`. |
| `team_memberships.is_lead` | `member_role = 'leader'` + `is_point_leader` | **Already exists.** Keep as is. |
| `reporting_lines` | org_edges `cross_team` rows from leaders, typed by hand | **Build.** New table keyed on `staff_ministries`. |
| `org_changes` | nothing | **Build** (table in H, behaviour in J). |
| `org_edit_log` | `okr_events` (197) covers OKR edits only | **Build for structure only.** OKR edits keep logging to `okr_events`; History merges the two. |
| `org_layout` | `org_nodes.x / y` (unused — dagre lays out) | **Build.** One row per ministry. |
| `okr_cycles` | `okr_cycles` (182) | **Extend.** Add `review_months`, `reset_on`. |
| `objectives` | `okr_objectives` (182) | **Extend.** Add `direction`, `ended_on`. `is_archived` stays. |
| `key_results` | `okr_key_results` (182) | **Extend.** Add `owner_user_id`, `source`, `metric_key`. `owner_note` stays as a fallback. |
| `key_results.state` (five states) | `current_status`, enum `okr_status` — the same five, `moving_forward` for doc 18's `moving` | **Already exists.** |
| `kr_checkins` | `okr_checkins` (182) — dated, with a trigger keeping current state | **Already exists.** Doc 18's "month" is `date_trunc('month', checkin_on)`. |
| OKR Shepherd | nothing | **Build** — `okr_shepherds (cycle_id, staff_ministry_id, user_id)`. |
| Monthly team update (42c) | nothing — check-ins are per KR, not per team | **Step J.** Not in H. |
| `okr_teams` (not in doc 18) | 182's OKR-only groups | **Retire.** See below. |
| `ministries` becomes a view over teams | `ministries` (088), 14 rows, bookings-owned, with an optional `staff_ministry_id` link (217) | **Do not convert in H.** See below. |
| `user_roles.scope_type = 'team'` → teams | `'team'` scope already means **`outreach_teams`** (`services/permissions.ts` `getScopeOptions`) | **Collision.** Needs a new scope value, not a repoint. |
| Outreach budget owner → teams | budgets are owned by `outreach_teams` | **Out of scope for H.** Different kind of team (DTS outreach groups). |
| Permission `org.admin` | `org.view`, `org.manage` (099), no holders | **Reuse `org.manage`.** See below. |
| Membership `person_id` → `people` | Hub staff are `users`; memberships key on `user_id` | **Use `users`.** Staff with no Hub account go to the unmatched queue. |

---

## Things the spec cannot have known

### "Nothing is deleted" breaks four existing write paths

Doc 18's first rule is that structure is ended, never deleted. Today:

- `api/ministries/[id]/members` **deletes** a membership when someone is removed.
- `api/admin/convert-to-community` **deletes** memberships.
- Trigger 206 **deletes** No Ministry rows when someone joins a main ministry.
- `api/ministries/[id]/leaders` upserts `onConflict: "staff_ministry_id,user_id"`,
  which relies on the table-wide `UNIQUE (staff_ministry_id, user_id)`.

That unique constraint also makes history impossible: someone who leaves
Media and rejoins next year cannot have a second row.

**H does:** replace the table-wide unique with a partial one
(`WHERE ends_on IS NULL`), switch the three delete paths to set `ends_on`,
and change the leaders upsert to find-then-update. These are small, but they
must ship in the same PR as the migration, or the first removal after it
silently erases history.

**And every reader must learn to ignore ended rows.** `leads_staff_ministry`,
`can_view_okr_objective`, the 131 `leadership_team` sync trigger, the 156 and
206 sync triggers, and the roster pages all treat "a row exists" as "is a
member". A leader whose membership has ended would keep editing rights. H
updates the SQL helpers in the migration; the code readers go into one
`activeMemberships` filter in `services/`.

### Sub-units

The chart's Training sub-teams are FFX, FFBX, FFSBI, RCA, FFLTrack, EFL. On
`main`, **Rooted Christian Academy and Ed for Life are already standalone
staff ministries**, and Training's roster is already split by
`staff_ministry_subcategories`. Doc 18 wants `parent_id` on teams.

Proposal: a chart sub-team becomes a **child ministry** (`parent_id`) only
when it already is a ministry or genuinely needs its own roster and lead (RCA,
Ed for Life). The rest stay **sub-categories** of their parent, which already
carry per-category point leaders. The chart draws both the same way.

### `okr_teams` should be retired

182 created OKR-only groups because "a team with no membership table has
nobody the database can call its leader". Since then, 195 added part-time
ministries, and four of the five OKR teams now **exist twice** — Hope Again,
Brave Love, Watchmen and Old Age Home are all `part_time` staff ministries.
Production has **zero** objectives owned by an `okr_team` (both live
objectives are ministry-owned).

So: add Evangelism as a part-time ministry (or confirm it is the Evangelism
module and not a ministry), set every `okr_teams` row inactive, and drop the
XOR constraint's second arm in a later migration once the UI stops offering
OKR teams. Nothing to repoint.

### `ministries` (088) should not become a view yet

It is a 14-row colour palette for bookings, written by the Venues & ministries
page and referenced by `venue_bookings.ministry_id` and
`booking_series.ministry_id`. It has names the rosters do not ("Brave Love"
had no ministry until 195) and the rosters have names it does not. 217
already solved the actual need — a leader managing their ministry's bookings —
with a link column. A view would make the colour and the bookings page
read-only overnight.

Proposal: leave it. Backfill the 217 link where names now match, and revisit
only if bookings ever needs ministries it cannot link.

### `org.admin` vs `org.manage`

099 already seeds `org.manage` ("author / edit the chart"), held by nobody,
and `has_org_chart_manage()` already gates writes on it. A second key would
mean two permissions for the same act. Proposal: reuse `org.manage`, rename
its display to "Administer org & OKR structure", and grant it to Sample Person 3 and
Sample Person 24. (Neither can be granted automatically — see the import numbers.)

### Team-scoped roles

Doc 18 says `user_roles.scope_type = 'team'` should point at `teams.id` and
end with the membership. On `main`, `'team'` already means an outreach team.
Repointing would silently re-scope every existing team-scoped grant. If
ministry-scoped roles are wanted, add `scope_type = 'ministry'`. Not needed
for H — ministry leaders get their scope from membership rows already
(`leads_staff_ministry`), which is the better model.

---

## The 099 import — real numbers

Read-only against production, 2026-10-18:

| | count |
|---|---|
| `org_nodes` | 212 — 171 person, 41 structural (root, 3 clusters, 14 teams, 17 sub-teams, 5 Missio streams, 1 Integrator role) |
| person nodes with `person_id` set | **0** — the link was never used |
| `org_edges` | 21 — 19 `cross_team`, 2 `parallel` |
| Hub users (excluding merged) | 255 |

A dry-run name match of the 171 person nodes against `users`:

| result | nodes |
|---|---|
| exact full name, one user | 48 |
| first name only, unique among users | 67 |
| first name only, more than one user (Sample Person 244, Sample Person 24 ×2, Sample Person 226, Sample Person 252, Sample Person 907, Sample Person 19, Sample Person 45) | 8 |
| no match (Sample Person 3 ×3, and other unmatched sample names) | 48 |

Only the **48 exact matches** should auto-link. A unique first name is not an
identity — "Sample" being the only Sample with an account today does not make
them the Sample on the chart. The other 123 go to the unmatched queue, with the
first-name and near-spelling candidates shown as suggestions for a person to
confirm. Both people meant to hold `org.manage` (Sample Person 3, Sample Person 24) are in that
queue, so resolving them is the first thing anyone does with it.

**Chart teams vs staff ministries:**

| Chart team | Staff ministry |
|---|---|
| Leadership Team, Prayer & Worship, Media, HULC, Operations, Training, Project 54, Woven | ✓ match (HULC = slug `hulk`) |
| 10/40 CrossFit | `1040` — match by hand |
| Finances & Legal, Donors & Dev, Events | **none** — create as ministries |
| Inside Ministry, Outside Ministry | **none** — these are Sample Person 3's and Sample Person 24's portfolios; reporting lines, not rosters? |
| — | Missio Ministry (chart has it as a stream), RCA, Ed for Life (chart sub-teams), 4 part-time, No Ministry |

**`cross_team` edges are not throwaway.** Doc 18 discards them because shared
service is derived from people holding two memberships. But on `main` those
second memberships do not exist yet — the edges are the only record that
Sample Person 21 serves Finances & Legal and Donors & Dev, or that Sample Person 279 does Events
media. Proposal: import each edge whose source matches a user and whose
target is a team as a **second membership** (`role_title` = the edge label,
`source = 'chart_import'`), and only then discard it. The 2 `parallel` edges
(Sample Person 244 and Sample Person 240 alongside Missio) become `reporting_lines` rows of kind
`alongside`.

**Existing memberships win.** 151 roster rows are live and maintained by
ministry leaders. Where the chart and the roster disagree, the import writes
the difference to the review queue; it never adds, moves or ends a live
membership on the chart's say-so.

---

## Step H, proposed

Migration **250** (next free on `main` and on every remote branch;
note 248 is already duplicated). Branch `redesign/H-org-data`.
No visible change except the import review list.

### 1. Structure on `staff_ministries`

```sql
ALTER TABLE staff_ministries
  ADD COLUMN cluster   text CHECK (cluster IN ('outward','inward','backbone','leadership','alongside')),
  ADD COLUMN parent_id uuid REFERENCES staff_ministries(id),
  ADD COLUMN purpose   text,
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on   date;
```

`is_active` stays and is kept in step with `ends_on` by a trigger
(`ends_on <= current_date` ⇒ inactive), so every existing reader keeps working.
Woven gets `ends_on = '2026-10-31'`.

### 2. History on `staff_ministry_members`

```sql
ALTER TABLE staff_ministry_members
  ADD COLUMN role_title       text,
  ADD COLUMN responsibilities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN share_pct        smallint CHECK (share_pct BETWEEN 0 AND 100),
  ADD COLUMN staff_kind       text NOT NULL DEFAULT 'staff' CHECK (staff_kind IN ('staff','volunteer')),
  ADD COLUMN starts_on        date,
  ADD COLUMN ends_on          date,
  ADD COLUMN source           text NOT NULL DEFAULT 'hub'
                              CHECK (source IN ('hub','training','events','chart_import'));
-- table-wide UNIQUE (staff_ministry_id, user_id) → partial unique WHERE ends_on IS NULL
```

Plus: `leads_staff_ministry`, `can_view_okr_objective` and the 131 / 156 / 206
triggers filter `ends_on IS NULL OR ends_on > current_date`. The three delete
paths and the leaders upsert change in the same PR (see above).

### 3. New tables

- `reporting_lines` — `staff_ministry_id`, `leader_user_id`, `kind`
  (`oversees` / `integrates` / `alongside`), `starts_on`, `ends_on`.
- `org_layout` — `staff_ministry_id` PK, `x`, `y`.
- `org_changes` — as doc 18. Created empty; behaviour is step J.
- `org_edit_log` — `table_name`, `row_id`, `field`, `before`, `after`,
  `actor_id`, `created_at`; trigger-written only, no insert policy, the same
  pattern as `okr_events`.
- `okr_shepherds` — `cycle_id`, `staff_ministry_id`, `user_id`.
- `org_import_queue` — one row per person node or edge the import did not
  apply: the node, its team, the reason, any suggested users, and a
  `resolved_user_id` / `resolved_at` / `resolved_by` once someone decides.
  Nothing is dropped; every one of the 212 nodes ends up either applied or
  in this table.

### 4. OKR columns

- `okr_cycles`: `review_months smallint[] DEFAULT '{3,6,9,12}'`, `reset_on date`.
- `okr_objectives`: `direction` (`presence` / `formation` / `mission` /
  `multiplication` / `care`), `ended_on`.
- `okr_key_results`: `owner_user_id`, `source` (`manual` / `linked`), `metric_key`.
- `okr_teams`: every row `is_active = false`; Evangelism added as a part-time
  ministry (pending the question below).

### 5. Import from 099

Run once, in the migration, idempotently:

1. Map the 14 chart teams to staff ministries using an explicit key table
   (`team-hulc → hulk`, `team-crossfit → 1040`, …), never by fuzzy name.
   Create the missing ones. Set `cluster` from the chart's cluster parent.
2. Person nodes with an exact full-name match → membership on the mapped
   ministry, `role_title` from the node subtitle, `source = 'chart_import'`,
   **only where no active membership exists already**. Everything else → queue.
3. `cross_team` edges → second memberships, same rules. `parallel` edges →
   `reporting_lines`.
4. Leadership Team members' portfolios → `reporting_lines` of kind `oversees`.
   The Integrator seat → `integrates`, holder from the queue once Sample Person 24 is
   resolved.
5. `org_layout` stays empty; the new canvas (step I) writes it.

099's tables stay untouched until step I is merged.

### 6. The one screen

A plain list at `/org-chart/import` (`org.manage` only): unresolved rows, the
suggested users, a picker, Resolve. Resolving writes the membership and the
edit log. No chart changes.

### Not in H

Seeding the 2026 objectives (needs `ORG_TEAMS` from the re-exported design
file), the canvas (I), change sets and monthly updates (J), linked KRs,
team-scoped roles, the `ministries` view.

---

## Answers so far (Jack, 2026-10-18)

1. **Inside Ministry / Outside Ministry are real ministries with their own
   rosters.** Create both as staff ministries. Sample Person 3 and Sample Person 24 can also assign
   people into them. So: Sample Person 3 is a leader of Inside Ministry and Sample Person 24 of
   Outside Ministry (which already lets each manage that roster through
   `leads_staff_ministry`), and each also gets an `oversees` reporting line
   from the Leadership Team.
2. **Evangelism the module is a separate thing** — statistics and testimony
   capture, not a team. The `okr_teams` row called Evangelism is retired with
   the others. If an Evangelism *team* ever needs OKRs, it becomes a part-time
   ministry then; H does not create one.
3. **Sub-units: yes, for now.** FFX / FFBX / FFSBI / FFLTrack stay
   sub-categories of Training; RCA and Ed for Life become child ministries of
   Training (`parent_id`). Expected to change later, and nothing in H makes
   that hard — moving a sub-category to a child ministry is a data move.

4. **Reuse `org.manage`** — yes.
5. **Removed people are kept as history** — yes.

---

## Step H as built (migration 250, branch `redesign/H-org-data`)

Two things changed from the proposal above while building, both for safety:

**History is a separate table, not `ends_on` on live rows.** The proposal
said to add `ends_on` to `staff_ministry_members` and teach every reader to
ignore ended rows. That is ~30 code readers, three RLS helpers and four
triggers, any one of which, missed, would let an ex-leader keep their rights.
Instead a `BEFORE DELETE` trigger copies the row into
`staff_ministry_membership_history` (with names snapshotted, sub-categories,
who removed them and when) and the live row goes as before. Every delete path
— the roster page, convert-to-community, trigger 206, a user being deleted —
is covered with **no code change**, and no reader can get it wrong. Pending
requests and the "No Ministry" placeholder are not archived. A *future* end
(a change set effective next month) is step J's job.

**The import applies nothing by itself.** Every chart box (171), connector
(21) and the Integrator seat land in `org_import_queue` with a match and
suggestions. A person with `org.manage` resolves them at `/org-chart/import`
— one by one, or "Apply N exact matches". Applying goes through SECURITY
DEFINER functions called with the user's own client, so the database checks
the permission and the edit log records who decided.

Tested against a copy of production rows in an in-memory Postgres: the
migration runs twice cleanly; 193 rows queue, all with a ministry; of the 58
exact matches, **39 were already on the roster** (left untouched), 16 became
new memberships and 3 reporting lines; a non-manager is refused; deleting a
membership — directly or by deleting the user — leaves a history row.

**After applying 250, by hand:**
- Resolve Sample Person 3 and Sample Person 24 in the queue (neither matches automatically).
- Grant them `org.manage` ("Administer org & OKR structure") in Users & Roles.
- Appoint Sample Person 3 leader of Inside Ministry and Sample Person 24 of Outside Ministry on the
  Ministry tab — that route also keeps the `ministry_leader` role in sync,
  which the import deliberately does not touch.

**Not in H:** seeding 2026 objectives (needs `ORG_TEAMS` from the re-exported
design file), the nightly job that ends Woven on 31 Oct, the canvas (I),
change sets and monthly updates (J).
