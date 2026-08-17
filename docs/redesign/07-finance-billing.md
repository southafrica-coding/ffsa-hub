# FFSA Hub — student billing handoff

Covers the redesign turns 18–27 in `FFSA Hub Redesign.dc.html`. Written against the
real repo (`ffsa-platform`) and the FFX 2027 doc.

---

## 1. The one rule everything rests on

**A scheduled charge is not an invoice.**

- **Scheduled** — exists only in the Hub. Free to rebuild, reprice, drop, re-date.
- **Issued** — exists in Xero. Can only be credited. Never rewritten, never backdated.

Every screen keeps those two words apart, and every destructive-looking action
(withdrawal, tier change, prepay, adjustment) is safe precisely because it only
touches the scheduled side.

---

## 2. Nothing about dates is hardcoded

A charge is configured per school, per tier. There is no built-in notion of "deposits
are due in January" or "tuition is monthly" — those are choices stored on the charge.

**Due anchor** (when the student must pay):

| Anchor | Fields | Use |
|---|---|---|
| `acceptance` | — | Deposits, short schools |
| `month_day` | `due_day`, `first_due_month`, `first_due_year`, `quantity` | Monthly tuition on long schools |
| `fixed_date` | `fixed_due_date` | Outreach, one-off dated charges |
| `relative_to_arrival` | `arrival_offset_days` | Anything on a school under ~3 months |

**Generation rule** (when the invoice gets created — a separate decision):

| Rule | Fields |
|---|---|
| `immediate` | — |
| `preceding_month_15th` | — |
| `fixed_date` | `generation_fixed_date` |
| `days_before_due` | `generation_lead_days` |

The FFX 2027 template in `src/lib/finance/billing.ts` is a **seed**, not a spec.
Seeding writes rows a school leader then edits. Do not treat any of its dates as
constants elsewhere in the code.

**Guidance to surface in the UI** (see 20a): `relative_to_arrival` and `acceptance`
work at any school length. `fixed_date` does not survive being copied to next year.
`month_day` assumes months exist inside the school and misbehaves under ~3 months.

---

## 3. The three axes a student is billed on

1. **Program** — FFXYL (whole program) or a standalone segment (FFXQ / FFBXQ / FFWVQ)
2. **Country tier** — A / B / C, derived from her country via the global tier table
3. **Organisation** — SA or US

Organisation is the axis the current schema is weakest on. It decides:

| | SA | US |
|---|---|---|
| Xero org | Fire &amp; Fragrance SA | Fire &amp; Fragrance US |
| Account | 1030 | 1020 |
| Tax rate | No VAT | Tax Exempt |
| Item codes loaded | 25 | 9 (tier A only) |

**Currency: everything is in ZAR for now.** Do not build multi-currency.

**Known data gap:** the US org has no tier B or C item codes — 16 missing. Screen 23c
lists them and exports a Xero-import CSV. Any run touching a US tier B/C student fails
until they exist.

---

## 4. Late joiners and the generation guard

The single most important behaviour to get right, and the one most likely to be built
as a crash.

When a student is accepted after a charge's generation date has passed:

1. Build her schedule normally. Do not skip charges, do not shift dates silently.
2. Mark every charge whose generation window has closed as `needs_decision`.
3. **Never create an invoice with a date in the past. Never auto-generate a charge
   whose window has closed.**
4. Surface them as one decision (screen 20b) with three named outcomes:
   - catch up as a single invoice, dated today
   - issue each separately, dated today
   - start her schedule from now (drop what she was never here for)

The same queue catches a school that was set up late, not just a student who applied
late. This must work for an eleven-days-before-start acceptance on a year-long school
as well as a four-months-late one.

---

## 5. Payment preference and prepayment

Field on the enrolment: `standard` | `quarter_prepay` | `full_prepay`.

Because the full schedule is stored and only becomes an invoice when due, prepayment is
a **timing change**, not a rebuild:

- combine remaining scheduled charges into one invoice
- release a single scheduled invoice early
- pay a specific charge (e.g. outreach) ahead of its date
- pick months by hand

Issued invoices are never touched by any of this.

---

## 6. Transitions

| Case | Behaviour |
|---|---|
| Quarter student continues into the next quarter | Add a second enrolment. First quarter's invoices untouched. New schedule built from **her** arrival date. |
| Prepaid, wants to go monthly | Credit the unused portion; rebuild remaining months on the standard schedule; credit offsets new invoices — no refund. |
| Moves onto the Year Long | Switch program; what she has paid carries as credit; only the difference is scheduled. |
| Withdraws | Scheduled charges dropped (not voided). Issued-and-unpaid need a per-invoice decision. Nothing deleted from history. |

---

## 7. Refunds

Screen 24b. Shows the arithmetic in the open: paid − non-refundable − consumed −
already-spent = refund.

On approval: drop remaining scheduled charges → create a Xero credit note → pay out →
mark withdrawn, keep the whole record. The same calculation prints as a letter.

**OPEN DECISION — needs real policy before build:**
- Is the deposit ever refundable, and within what window?
- Is tuition pro-rated weekly, monthly, or by charge already fallen due?
- Are committed third-party costs (flights, visas) deducted at actual cost?

The design currently uses placeholder terms shaped like a policy.

---

## 8. Approval limits

One matrix, set by finance, read by every screen that gives money away (23b, 24b, 27a).

| Action | Staff | School leader | Finance |
|---|---|---|---|
| Bursary or discount | R 2 000 | R 10 000 | any |
| Waive a charge | no | R 10 000 | any |
| Write off | no | no | any |
| Refund | no | R 10 000 | any |
| Change her tier | no | yes | yes |

Rules: over your limit is not a wall — you build it and send it on, and the approver
sees what you wrote and why. **Nobody approves their own.** Every sign-off stores a
name and a timestamp.

---

## 9. Xero contract

**Out of the Hub → Xero**
- Invoice creation is a distinct step from sending. Create as *awaiting approval*.
- Always preceded by a dry run listing every invoice, with skipped and overdue rows
  visible rather than silently dropped (18b).
- Line items carry `xero_item_code`; org decides account + tax rate.
- Reference format: `{PROGRAM}{YEAR} · {SURNAME} · {PERIOD}`.
- Credit notes for refunds and unused prepayment.

**Xero → the Hub (webhooks)**
- Payment events update balances without human action.
- Matching policy (22a):
  - **on invoice number** → matched, closed silently
  - **on name + exact amount** → matched, notify the staff member walking with her
  - **on name alone** → never auto-matched; goes to the reconciliation inbox
- Unmatched, partial and overpaid money lands in the inbox (22a/22b) with candidate
  suggestions and reasons. Options: allocate to one person, split across several,
  or hold as unallocated. Held money stays visible; it is never forced onto the
  nearest plausible student.
- Overpayment becomes credit, consumed by her next invoice before new money is asked for.

**Recommendation:** the Hub owns scheduling, not Xero recurring invoices. Xero recurring
cannot see tier, arrival date, withdrawal or the generation guard. Xero is the source of
truth for *payments*; the Hub is the source of truth for *schedules*.

---

## 10. Email is the only guaranteed channel

Not every student has a Hub account. **No one is ever required to log in to pay.**

The invoice email carries, in the body: amount, reference, full bank details, and a
tokenised pay link that needs no password. Statement attaches as PDF.

Four emails per charge, all editable per school as "moments" (15b/15c):

| Moment | When |
|---|---|
| Invoice | 20 days before due (i.e. generation date) |
| Reminder | 3 days before due |
| Overdue | 2 days after due |
| Receipt | the moment Xero reports payment |

Every one repeats the reference and bank details in full.

- A bounced address is a **broken account**, not a silent failure — it lands on her
  record and on the staff member walking with her.
- A second recipient (parent, sending church) can be added per student without a login.
- The email address is effectively the primary key. The import (26c) matches on it,
  refuses rows without it, and never creates duplicates. Importing emails nobody.

---

## 11. Where each screen lives

**Training** — school detail + roster (14a), grades (14b), applicant review (14c),
form builder (15a), messages (15b/15c), student mail (16a), compose (16b/17b),
**student fees tab (27a)**.

**Finance** — fee structure (18a), invoice run (18b), student money (18c), orgs &amp;
item codes (19a), payment arrangement (19b), transitions (19c), short school (20a),
late joiner (20b), add a charge (21a), invoice preview (21b), record a payment (21c),
copy to next intake (21d), reconciliation (22a/22b), country tiers (23a), adjust (23b),
missing codes (23c), refund (24b), debtors (26a).

**Student portal** — my fees (24a), pay flow (25b).

**Admin settings** — approval limits (26b), student import (26c).

The join is the student record: 27a is the Training-side read of 18c, with only the
actions a school leader takes (record a payment, write to her, adjust within limit).
Prices, dates and invoices are set in Finance; that tab reads them.

---

## 12. Build order

1. Charge items + schedule generation with all four anchors and all four generation
   rules. No hardcoded dates anywhere.
2. The generation guard and the `needs_decision` queue (20b) — before any automation.
3. Dry run → create → send as three distinct steps (18b, 21b).
4. Xero webhooks + the matching policy + the reconciliation inbox (22).
5. Email moments with in-body payment details and tokenised pay links (25).
6. Approval matrix, then adjustments and refunds on top of it (26b → 23b → 24b).
7. Student fees tab (27a) and portal fee view (24a).
8. Debtors (26a) and copy-to-next-intake (21d).
