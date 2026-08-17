# Training in depth + Messages — handoff

Covers turns 14–17 of `FFSA Hub Redesign.dc.html`. Read after `06-screen-recipes.md`.

---

## 1. School detail (14a)

`src/app/(admin)/schools/[programId]/program-detail.tsx`.

Three-part layout inside the content area:

- **Masthead** — breadcrumb (mono, 10px, 0.2em), then the school name as condensed 900
  at 56px over two lines, then a mono line: dates · weeks · location. Actions right.
- **Tabs** — Students / Courses &amp; Grades / Application Form / Applicants. Active tab is
  a solid black bar, not an underline.
- **Body** — 300px phase run on the left, roster on the right.

**Phase run.** One bordered row per phase. Only the *current* phase gets a black border
and 900 weight; done and future phases get the hairline. Each row: a 9px square status
mark (black done / yellow now / #DEDACE future), name, length, a 5px progress bar, and a
mono status line. Below the run, two large KPI numerals (students enrolled, staff on school).

**Roster.** A real table, six columns: student (avatar + name) · from · status · walking
with · fees · graded. Status is a filled pill, not an outline. Fees text turns amber
(#8A6400) and 700 weight when money is owed. "Walking with" renders `—` in #B4B0A2 when
nobody is assigned, which is what the NeedsYou band at the bottom counts.

Filter chips above the table: `ALL 28` is solid black, the rest are hairline-bordered.

---

## 2. Grades (14b)

A matrix, not a form per student. `250px` name column, then one column per course,
then a bordered average column.

- Course headers stack: code (condensed 900, 18px), name (11px), credits (mono 8.5px).
- Cells are a single letter grade, condensed 900 at 20px, centred, tabular.
- **Ungraded is an empty white cell** — no dash, no placeholder. The holes are the point.
- Hover a cell to yellow; it edits in place as a select.
- Footer states when it last saved and who by, plus export / print transcripts.

---

## 3. Applicant review (14c)

Everything on one screen, 1180×900.

- **Pipeline strip** across the top: one box per stage with a big numeral. The stage
  needing attention is filled yellow with a black border; the rest are hairline.
- **Left** — her identity block (yellow tick + mono context line + 46px condensed name +
  contact), then her answers. Question labels are mono 9.5px uppercase; **answers are
  15px/1.5 body text**. Do not shrink answers to fit; this is the one screen where
  reading matters more than density.
- **Right** — References (per slot: type, status in green/amber, name, org), then
  Readiness (four checks), then an internal note with a 3px black left rule.
- **Decision bar** pinned to the bottom, outside the scroll: Reject (grey border) ·
  Waitlist (black border) · Accept (solid black). A mono line states what accepting does.

---

## 4. Application form builder (15a)

One readable list, top to bottom. No canvas, no drag-from-palette panel.

- A **section** is a black bar row (white condensed 900 text).
- A **question** is a white hairline row: drag handle, label, type pill, required flag.
- A **conditional follow-up** is indented 26px, sits on #F7F5EE, and carries a yellow
  `SHOWS WHEN · YES` pill. The branching is visible in the shape of the list.
- A question that reveals others shows `2 FOLLOW-UPS` in amber.
- Field types live in the left panel as small chips; clicking one appends a question.
- **References** are configured in their own black-barred block below the questions:
  one row per slot with label, help text, required/optional.
- **Right 420px** — live public preview on bone, rendering the real form as an applicant
  sees it, including the yellow-ruled conditional block.

---

## 5. Messages (15b) — the model that matters

Every email a school sends is a **named moment**, not a template in a folder. One list
per school, one row per moment:

| Column | Notes |
|---|---|
| On/off | 34×18 square toggle, black when on |
| Moment | condensed 900, 19px, uppercase |
| Goes to | audience in words ("International students only") |
| When | mono: `IMMEDIATELY`, `+5 DAYS`, `−60 DAYS BEFORE START`, `ON DECISION` |
| Words | `FFSA DEFAULT` (grey, hairline) or `THIS SCHOOL` (black border) |
| Sent | count, or `NEVER SENT` |

**Off moments grey the row rather than hiding it** — you must be able to see what you
have chosen not to send. The seed list, from the real codebase templates: application
received, reference request, reference reminder, interview scheduled, accepted,
waitlisted, not accepted, deposit reminder, visa &amp; travel pack, what to bring,
outreach fundraising, graduation &amp; transcript.

### Message editor (15c)

Everything that decides what lands in her inbox, on one screen:

- from-identity and reply-to
- subject
- merge-field chips (`first_name`, `program`, `start_date`, `deposit_due`, `balance`,
  `portal_link`, `staff_name`, `outreach_country`, `arrival_date`, `full_name`)
- body, with merge fields shown as yellow-highlighted mono tokens inline
- **condition** — `ONLY SEND IF DECISION = ACCEPTED`, plus add-condition
- **right rail** — preview rendered with a *real applicant's data* (never braces),
  inside the actual black-header email shell; then "what follows this" (the chain, active
  step black with yellow timing); then the last four sends with delivery state
- footer: revert to FFSA default · send me a test · save draft · save &amp; use

**Schema sketch**

```
school_message_moments
  id, program_id, moment_key, enabled,
  audience, timing_kind, timing_offset_days,
  subject, body, from_identity, reply_to,
  condition_json, source ('default' | 'school'),
  updated_by, updated_at

message_sends
  id, moment_id (nullable — hand-written mail), student_id,
  subject, body_rendered, sent_at, state, opened_count, replied_at
```

`source` is what drives the FFSA DEFAULT / THIS SCHOOL pill and makes revert possible.

---

## 6. Student mail (16a) and compose (16b, 17b)

**Mail tab on the student record.** Automatic and hand-written email in one list,
newest first. Each row: subject (700), kind pill (bone for automatic, black+yellow for
`WRITTEN BY KIM S.`), timestamp, delivery state, and how it was sent. Hover reveals four
actions: resend as is · edit &amp; resend · view what she got · copy into new email.

**Resending never overwrites.** It appends a new send row. Say so in the footer.

**Compose drawer.** Opens over any list. Starts blank, from a saved moment, or from
something already sent. Recipient chips, merge fields, attach, send later, test to me.
Everything lands on the student's timeline.

**Bulk (17a/17b).** Selecting rows on any list raises a black action bar with the
selection count and the actions for it, including `WRITE TO THESE 4`. The drawer is the
same one; the recipients are chips. **It sends N separate emails**, each with that
person's own merge values — never one thread. A "check it as" selector swaps the preview
between recipients so the numbers can be verified before sending.

The same drawer must open from: student record, school roster, finance, contacts, and an
event's registrations.
