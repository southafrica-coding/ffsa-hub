# Student billing — what exists vs what the handoff asks for

`07-finance-billing.md` reads as a greenfield spec. It isn't one. Migration **095
(`school_billing_engine`) is applied** and its model already matches the handoff closely
— including the part the handoff treats as the hard bit.

Proof that 095 is applied: migration 098 (`billing_courses`, applied) runs
`TRUNCATE public.student_billing_plans CASCADE` and alters that table. It could not have
succeeded otherwise. Any note saying 095 is unapplied is stale.

---

## Already built

| Handoff asks for | Status |
|---|---|
| Charges carry their own **due anchor** — `acceptance`, `month_day`, `fixed_date`, `relative_to_arrival` | ✅ `program_charge_items.due_anchor`, all four, with `due_day` / `first_due_month` / `fixed_due_date` / `arrival_offset_days` |
| Charges carry their own **generation rule** — `immediate`, `preceding_month_15th`, `fixed_date`, `days_before_due` | ✅ `program_charge_items.generation_rule`, all four, with `generation_fixed_date` / `generation_lead_days` |
| Schedule is stored, invoices created later | ✅ `student_billing_schedule` with `scheduled_generation_date`, `due_date`, `status` (scheduled → generated → sent → paid → cancelled) |
| Per school / per tier structures | ✅ `school_fee_structures`, `fee_charge_items`, `payment_fee_profiles` |
| FFX 2027 template as a **seed** | ✅ `src/lib/finance/billing.ts` |
| Schedule expansion | ✅ `src/lib/finance/schedule-builder.ts`, wired into `/api/finance/school-fees/{billing-plans,student-program-billing}` |
| Country tiers A/B/C | ✅ `country_tiers` (migration 097) |
| Xero item codes, tokens | ✅ `xero_tokens`, `xero_item_code` on programs/courses |

**So handoff sections 1–2 are done.** The "no hardcoded dates" rule is already honoured
by the schema.

---

## Missing — in the handoff's own build order

| # | Gap | Notes |
|---|---|---|
| 1 | **`billing_mode` / `schedule_start_date`** (09-going-live) | Does not exist anywhere. Nothing protects the two running schools. **Build first.** |
| 2 | **Generation guard + `needs_decision`** (§4) | `schedule-builder.ts` has no notion of a closed generation window, and `student_billing_schedule.status` has no `needs_decision`. The handoff calls this "the single most important behaviour to get right, and the one most likely to be built as a crash". |
| 3 | Dry run → create → send as three steps (§9) | No dry-run surface; create/send not separated |
| 4 | Xero webhooks + three-tier matching + reconciliation inbox (§9) | Not built. Note the existing ticketing webhook work is a separate system |
| 5 | Approval matrix, adjustments, refunds (§7–8) | Not built. §7 has **open policy questions** that need real answers before code |
| 6 | Email moments (§10) + `school_message_moments` / `message_sends` (08 §5) | Not built. Every later feature sends through this |
| 7 | Organisation axis SA/US (§3) | Weakest part of the current schema, per the handoff itself. 16 missing US tier B/C item codes is a **data** gap |
| 8 | Payment preference / prepay (§5), transitions (§6) | Not built |
| 9 | Training depth: school detail, grades matrix, applicant review, form builder (08 §1–4) | Not built |

---

## Order I'd build in

Straight from the handoff's §12, with the going-live switch first because it is what
makes everything after it safe to experiment with:

1. **`billing_mode`** — two rows of data change and the running schools are untouched.
2. **Generation guard + `needs_decision` queue** — before any automation exists.
3. Dry run → create → send.
4. Xero webhooks + matching + reconciliation inbox.
5. Email moments (needs the Messages tables from 08 §5).
6. Approval matrix → adjustments → refunds.
7. Student fees tab + portal fee view.
8. Debtors + copy-to-next-intake.

Training depth (08 §1–4) is independent of all of this and can run in parallel.

---

## Decisions taken (2026-08-17)

**Refunds (§7).** The deposit **is** refundable today, **and that is expected to
change**. Flights, visas and other third-party costs are **not** deducted — they are not
treated as part of the cost. So:

- refundability is **configuration, not a constant**. No `DEPOSIT_REFUNDABLE = true`
  anywhere; it is a stored setting with a history, so changing it later does not
  retroactively rewrite what an old refund was calculated against.
- the third-party deduction line comes **out** of the model entirely.
- the refund arithmetic reduces to `paid − non-refundable − consumed`.
- **still open:** what "consumed" means — pro-rated weekly, monthly, or by charges
  already fallen due. Make it configurable the same way rather than guessing.

**US organisation (§3).** **US students are always tier A.** The handoff's "16 missing
US tier B/C item codes" is therefore **not a data gap** — those codes are not needed and
should not be created. The US org needs tier A only. Screen 23c's missing-codes export
should not list them, and any US enrolment resolving to tier B or C is a **bug to
surface**, not a case to bill.

**Going live (09).** Neither school has started — but **both are well into their payment
process**, collected outside the Hub.

⚠️ **This is a bigger deal than the original "one nearly finished, one with months left"
framing, and it changes what adoption means.** `schedule_start_date` alone is not enough:
it filters by *date*, and the problem here is *money already taken*. If a school is
switched to `hub_scheduled` and its schedule is built, the Hub will happily schedule
charges that students have already paid, then invoice them again.

Adoption for these two therefore needs, before any generation:
1. what each student has already paid, recorded as an opening credit; and
2. the charges that money covers marked as settled, not merely dated in the past.

Until that exists, both schools stay `external` (migration 172 already put them there).
