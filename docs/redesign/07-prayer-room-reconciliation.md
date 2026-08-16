# Prayer Room — reconciling the handoff with what already exists

`05-prayer-room-schema.md` is written as if the prayer room were greenfield.
It is not. The module has been live since June 2026 across migrations
084 / 102 / 108 / 109 / 110 / 117, and it is used weekly (it posts block-outs
to Slack).

Building that file verbatim would create `prayer_sets` beside
`prayer_room_sets`, and `prayer_evaluations` beside `prayer_room_evaluations` —
two parallel models for one module, with the live one orphaned or broken.

This document maps every table and rule in the handoff onto the real schema and
says what to do about each. **The design's intent survives almost entirely; only
the table list changes.**

---

## What exists today

| Table | Role |
|---|---|
| `prayer_room_members` | approved-member profile · `is_evaluator`, `is_coordinator`, `status` |
| `prayer_room_template_blocks` | the weekly template — day, times, title, `role_needs` jsonb |
| `prayer_room_sets` | an instantiated set — date, times, title, theme, scripture, `prayer_focus`, owner, status |
| `prayer_room_set_slots` | **the seats** — `role`, `required_label_id`, open/invited/filled/declined, invite flow, `occupied_range` |
| `prayer_room_set_series` | recurrence (109) |
| `prayer_room_blockouts` | block-outs (110/117) |
| `prayer_room_applications` + `_application_skills` | join-the-team pipeline |
| `prayer_room_evaluations` | evaluation of an **application**, single `notes` field |
| `user_labels` + `user_label_assignments` | "skills" — binary, no state |
| permission `prayer_room.evaluate` (102), role `prayer_room_admin` | authz |

Two things the design asks for are **already implemented**, and better than the
handoff proposes:

- **Clash detection (rule 4)** — enforced in the database. Migration 108 adds
  `prayer_room_block_cross_set_overlap()`, a trigger over `occupied_range`
  (tstzrange, btree_gist), so one person cannot hold two overlapping seats.
- **Unbooked time is not a row (rule 7)** — already true. Sets are rows; gaps
  are derived.

---

## Table-by-table verdict

| Handoff table | Verdict | Action |
|---|---|---|
| `prayer_seat_types` | **partial** — seats exist as a CHECK on `set_slots.role` with 4 values (worship_leader, vocals, instrument, prayer_leader) | **Promote to a table** `prayer_room_seat_types`. Needed for the richer lineup (keys, acoustic, sound, scribe, co-lead) and for category-scoped evaluators. Backfill the 4 existing values, add `seat_type_id` to `set_slots`, keep `role` until callers move. |
| `prayer_sets` | **exists** as `prayer_room_sets` | Do **not** create. Add one column: `type` (intercession / worship / prophetic). |
| `prayer_bands` | **exists in spirit** as `prayer_room_template_blocks` | Do **not** create. Extend with `name` (MORNING/NOON/NIGHT), `weekly_focus`, `lead_user_id`, and `is_curated` (see rule 6). |
| `prayer_set_seats` | **exists** as `prayer_room_set_slots`, and richer than the handoff (invite flow, `position`, `required_label_id`, range guard) | Keep. Add `seat_type_id` FK. |
| `prayer_qualifications` | **genuinely new** — today qualification is a binary label assignment with no state | **Create**, keyed `(user_id, seat_type_id)` with `state` ∈ not_evaluated / in_training / signed_off. Decide whether instrument labels stay as labels or fold in. |
| `prayer_evaluations` | **conflict** — `prayer_room_evaluations` exists but is application-scoped with one `notes` | **Extend the existing table**, don't add a second: `seat_type_id`, `outcome`, `feedback`, `private_note`, `observed_set`. Treat legacy `notes` as **private** when migrating — it was written when authors had no expectation the subject would read it. |
| `prayer_seat_requests` | **new** — the existing flow runs the other way (a lead invites) | **Create.** Complements the invite flow; does not replace it. |
| `prayer_evaluation_requests` | **partial** — `prayer_room_applications` covers "let me join" once, not per-seat re-evaluation | **Create** a small table rather than overloading the live onboarding pipeline. |
| `prayer_evaluators` | **exists, better** — `prayer_room_members.is_evaluator` plus the `prayer_room.evaluate` permission shipped in 102 | **Do NOT create.** A second authz source would re-open exactly the roles-vs-permissions split this repo already spent migrations 081–091 closing. Add `evaluator_scope` to `prayer_room_members` instead. |

---

## Rule-by-rule verdict

1. **A set is live if a lead seat is filled; otherwise it is a dashed
   NEEDS A LEAD block and the other seats are locked.** New, but **derivable** —
   no schema needed. The lock is a write-path rule plus UI.
2. **Prayer lead ≠ worship lead.** Satisfied for free once qualifications are
   keyed by `seat_type_id`. Both roles already exist as distinct slot roles.
3. **Seat filling is qualification-gated,** picker sorted by ascending load over
   30 days, in-training selectable only via explicit override that notifies
   evaluators. New logic. Today's gate is the weaker `required_label_id`.
4. **Clash detection.** ⚠️ **Behaviour conflict.** Today the database *hard
   blocks* an overlapping assignment (108 trigger). The design wants the clash
   *surfaced in the picker* ("On Selah at 09:30") rather than blocking silently.
   These are different products. Recommendation: keep the trigger as the
   backstop and surface the clash in the picker before submit — the user gets
   the design's behaviour and the data keeps its guarantee.
5. **Note visibility enforced in RLS, not the UI.** New and the highest-risk
   item. `private_note` must never reach the subject — use an evaluator-only
   view that does not select the column at all, rather than relying on a policy
   over the base table.
6. **Curated bands are not bookable.** Needs the `is_curated` flag above plus
   write policies; sets generated from a curated block cannot be claimed or
   deleted by a non-evaluator.
7. **Unbooked time is not a row.** Already true. No work.

---

## Suggested sequencing

Each phase is shippable and leaves the live module working.

- **Phase A — seat vocabulary.** `prayer_room_seat_types` + backfill +
  `seat_type_id` on `set_slots`. No visible change; unblocks everything else.
- **Phase B — qualifications.** `prayer_room_qualifications`, plus
  `evaluator_scope` on members. Picker starts gating on state.
- **Phase C — evaluations.** Extend `prayer_room_evaluations` with the two-note
  model and the RLS/view split. **Do this one carefully** — it is the piece
  that carries a privacy promise.
- **Phase D — requests.** Seat requests + evaluation requests, and the leads'
  inbox.
- **Phase E — bands.** Extend `template_blocks`, mark curated, lock booking.
- **Phase F — the wall (frame 8a).** Mon–Fri, continuous time axis, the four
  block tones. UI only by this point.

Migration numbering starts at **167** (166 is merged; 164–165 are in flight on
the redesign branch).

---

## Things to decide before Phase A

1. **Do instrument "skills" (`user_labels`) stay?** Qualifications overlap with
   them. Cleanest: qualifications govern *seats*, labels keep describing
   *instruments*. Needs your call.
2. **Rule 4** — confirm the recommendation above (keep the hard block, surface
   the clash earlier).
3. **Legacy evaluation notes** — confirm they migrate to `private_note`.
4. **Does the wall replace the current prayer-room views, or sit beside them?**
   The existing week/day views are in daily use.
