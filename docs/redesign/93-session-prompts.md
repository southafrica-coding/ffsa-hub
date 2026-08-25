# Session prompts

One session per block. Paste the block as the opening message. Each is scoped so
"done" is checkable in a sitting — see the working agreement in
`91-build-status-and-gaps.md`.

Every prompt assumes: branch off `origin/main`, next migration number is **176**
(check `ls supabase/migrations | sort | tail` first — numbering has collided
twice), and report by frame id with screenshots.

---

## Running these in parallel

Parallel worked well for the step-6 screens (six agents, disjoint directories).
It breaks on four specific things, all avoidable.

**1. Migration numbers collide.** This has already happened twice (116, then 164
and 167 simultaneously). Two sessions both take "the next number" and the folder
ends up with duplicates that nobody can order afterwards. So **pre-assign a
number per session before starting**, and tell each session its number:

| Session | Migration |
|---|---|
| 2 Communications | 176 |
| 5 Billing | 177 |
| 6 Outreach | 178 |
| 1, 3, 4, 7 | none expected — ask before taking one |

**2. Shared files conflict.** `src/components/ffsa/index.tsx`, `src/app/globals.css`
and `tailwind.config.ts` are wanted by everything. Any session that needs a change
there should **report it rather than make it**, and one person applies it centrally
between merges. That convention already worked once.

**3. One worktree per session.** Two chats pointed at the same folder overwrite
each other. `git worktree add -b <branch> ../ffsa-<name> origin/main`, and give
each its own dev-server port — a second server on 3210 silently attaches to the
wrong code, which cost this project three separate confusions in one day.

**4. You are the review bottleneck.** Unreviewed parallel output is exactly how
28 routes shipped unseen. Keep **two or three in flight at most**, and merge one
at a time, merging `main` back into the others after each.

### Dependency order

Only one hard dependency: **session 2 must land before session 3** and before
session 5's email moments, because doc 11 owns the messages model that both sit
on. Everything else is independent.

Suggested shape:

1. **Session 1 alone** — visible win, no migration, nothing depends on it.
2. **Session 2 alone** — the backbone; do its reconciliation properly.
3. **Sessions 3 + 4 + 7 in parallel** — disjoint directories, no migrations.
4. **Sessions 5 + 6 in parallel** — both finance but different areas (school fees
   vs outreach), with 177 and 178 pre-assigned.

---

## 1 — Prayer room UI

```
Read docs/redesign/91-build-status-and-gaps.md first, including the working
agreement. Don't trust earlier "done" claims.

Open docs/redesign/design/FFSA Hub Redesign.dc.html and scroll to frames 9a,
9b, 10a, 10b, 11a, 12a, 12b. Build from the frames, not the written recipes.

SCOPE: the prayer room UI only. Nothing outside src/app/(admin)/prayer-room
plus the primitives.

What's already true: the data layer is complete and verified end to end
(migrations 168-171, 175). The wall (8a) exists. The module has ZERO
mastheads across 19 files, and its week/day calendar views were already
replaced by the wall.

Build: the module masthead + tab chrome; the 9a set drawer (470px, source
block inverts to black, driven from block data not hardcoded strings); the
People tab (10a/10b); the person profile (11a); the evaluators portal as its
own tab (12a/12b) — the queue and band curation currently sit bolted inside
the old Evaluations tab.

Two things that surprise people: a set OWNER is not a filled LEAD SEAT, so a
set with an owner still reads NEEDS A LEAD (design rule 1, as written); and
no template block has is_curated set yet, so the wall shows no yellow anchor
bands until one does.

Per frame: screenshot beside the frame, 1440px and 375px. Update
91-build-status-and-gaps.md before finishing. Do not tell me "step 7 is done".
```

---

## 2 — Communications backbone

```
Read docs/redesign/91-build-status-and-gaps.md, then docs/redesign/11-communications.md
in full. Open the design file at frames 29a-31e.

SCOPE: the messages model and the frames above. This is the module every other
module sends through, so it comes before more modules are stacked on it.

FIRST, DO A RECONCILIATION — do not write SQL until you have. There is already
an email_messages ledger (migration 141) with Resend webhooks, plus campaigns,
campaign_recipients, a v_campaign_stats view, sending identities, labels and
suppressions. Doc 11 proposes a single `messages` table for everything the Hub
sends. Map doc 11 onto what exists and write the result to
docs/redesign/94-communications-reconciliation.md before building — the prayer
room went well because that step happened first, and billing went well for the
same reason.

Note doc 11 SUPERSEDES the narrower school_message_moments / message_sends
sketch in 08-training-and-messages.md §5. Billing's email moments (07 §10) and
school moments both sit on top of whatever you build here.

The `reason` column is load-bearing: written at send time in plain words ("She
is in DTS 26-2 students"), it is what 29d's "why she got it" reads. Do not
reduce it to an enum.

Report by frame id with screenshots. Update the status file.
```

---

## 3 — Training in depth

```
Read docs/redesign/91-build-status-and-gaps.md, then 08-training-and-messages.md
sections 1-4. Open the design file at frames 14a, 14b, 14c, 15a.

SCOPE: src/app/(admin)/schools only. Skip section 5 (Messages) — that belongs
to doc 11 and session 2.

Note the shell is ALREADY recomposed (verified 2026-08-25): schools/page.tsx,
[programId]/page.tsx and program-detail.tsx all carry .ffsa-screen and a
Masthead from the step-6 pass. What is missing is the DEPTH below that chrome.

14a school detail: masthead with breadcrumb, 300px phase run on the left
(only the CURRENT phase gets a black border and 900 weight), roster table with
six columns — student · from · status · walking with · fees · graded. Fees
text turns amber and 700 weight when money is owed; "walking with" renders an
em dash in #B4B0A2 when nobody is assigned, which is what the NeedsYou band
counts.

14b grades: a matrix, not a form per student. Ungraded cells stay EMPTY WHITE —
no dash, no placeholder. The holes are the point.

14c applicant review: answers at 15px/1.5 body text. This is the one screen
where reading matters more than density — do not shrink answers to fit. The
decision bar is pinned outside the scroll.

15a form builder: one readable list, no canvas. Conditionals indent 26px on
#F7F5EE with a yellow SHOWS WHEN pill.

Watch out: program-detail.tsx is ~4,400 lines and its Grades tab was set aside
earlier (unlinked, intact). billing_courses IS the course model — Training owns
course structure, Finance owns money.

Screenshots per frame. Update the status file.
```

---

## 4 — Bookings calendar

```
Read docs/redesign/91-build-status-and-gaps.md. Open the design file at frame 3c.

SCOPE: src/app/(admin)/bookings. SMALLER THAN IT LOOKS — verified in code
2026-08-25.

3c's geometry IS ALREADY BUILT. src/app/(admin)/bookings/day-timeline.tsx (242
lines) puts spaces AND vehicles on one timeline with the 230px resource column,
percentage-positioned blocks, lane packing via blockWindow / packLanes /
computeHourRange, and per-row clash ids. READ IT FIRST — do not rebuild it.

What is actually missing: it is mounted READ-ONLY as a "Today" strip on the
bookings hub (page.tsx ~line 240, under a SectionBar). This session promotes it
to the main bookings experience — date navigation off today, the full visible
hour range rather than a strip, and whatever interaction 3c shows.

Hard constraint: spaces and vehicles are SEPARATE services with SEPARATE
permission modules. Fetch and gate each half independently — someone who can
see vehicles but not spaces must see only vehicle lanes, with no error and no
empty "Spaces" heading. Vehicle bookings are date-only in the schema, so they
are all-day by definition.

Screenshots at 1440 and 375. Update the status file.
```

---

## 5 — Billing: dry run, create, send, reconciliation

```
Read docs/redesign/91-build-status-and-gaps.md and 90-billing-reconciliation.md,
then 07-finance-billing.md sections 9-10. Open the design file at frames 18b,
21b, 21c, 22a, 22b.

SCOPE: finance/billing. 9a (billing_mode) and 9b (generation guard + held
queue) are built, applied and tested — do not rebuild them.

Build: dry run -> create -> send as THREE distinct steps, buttons kept apart.
Create as "awaiting approval", never send in the same action. The dry run lists
every invoice with skipped and overdue rows visible rather than silently
dropped. Then Xero webhooks in, with the three-tier matching policy (invoice
number = silent; name + exact amount = match and notify; name alone = NEVER
auto-matched, goes to the inbox) and the reconciliation inbox where held money
stays visible.

Already there: the Xero read side (listXeroInvoices), correct per-region org
pinning, createScheduledInvoice and generateDueInvoices, and a per-school
billing_emails_enabled flag that must gate every send.

Both schools are billing_mode=external and MUST STAY THAT WAY — they are
mid-payment outside the Hub, so switching one on before opening balances exist
would re-invoice students. Never create an invoice dated in the past.

Add tests like the guard's. Screenshots per frame. Update the status file.
```

---

## 6 — Outreach budget

```
Read docs/redesign/91-build-status-and-gaps.md, then 10-outreach-budget.md in
full. Open the design file at frames 28a-28f.

SCOPE: the outreach side of finance.

Already there: outreach_teams, outreach_team_budgets, outreach_budget_categories,
outreach_expenses, outreach_receipts, outreach_cash_batches, outreach_fund_releases,
plus a recent-movements ledger and an unmatched-payments block on the outreach
dashboard. Reconcile doc 10 against those before adding tables — same discipline
as sessions 2 and 5.

The spreadsheet import (28b/28c/28d) is the risky part: it must say what it did,
allow starting again, and never silently create duplicates.

Screenshots per frame. Update the status file.
```

---

## 7 — Public event page, mobile portal, and the old routes

```
Read docs/redesign/91-build-status-and-gaps.md. Open the design file at frames
4c and 4d.

Three things, in this order.

4c public event page — the loudest surface, and the only place the brand runs at
full volume: full-bleed photo masthead, 118px condensed title, facts strip of
four bone cells, body copy left with the registration form inline right.
CRITICAL: there are six event brands with bespoke storefronts (the_send,
ffsa_camps, preachers, wild_ones, missio, ff). Event brand kits are OUT OF SCOPE
and keep their own fonts and colours — 4c is the generic F&F storefront only.
Do not touch the others.

4d mobile portal — bottom tab bar, 4 items, 48px targets, one big numeral per
screen, list rows two lines never three.

Then the 28 admin routes still on the old design, highest traffic first:
contacts (8 routes), users (2), then teams, settings, org-chart, mission,
ministry, consents, records-library, roles. When the last one is done, delete
the transition scaffold: the `.admin-content > *:not(.ffsa-screen)` rule in
globals.css and its wrapper in src/app/(admin)/layout.tsx.

Screenshots. Update the status file after each group, not just at the end.
```
