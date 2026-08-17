# Outreach budgets — handoff

Frames 28a–28d in `FFSA Hub Redesign.dc.html`. Written against the finance lady's
24-point brief. Build inside the existing Hub design system and data structures —
this is not a separate budgeting tool.

---

## 1. What an outreach budget belongs to

Not always a school. `outreach_budgets` carries a polymorphic owner:

```
owner_kind_id  → outreach_owner_kinds (school | ministry | ministry_team | …)
owner_id       → the specific school / ministry / team
```

`outreach_owner_kinds` is a **table, not an enum** — a region, partner church or
conference must be addable without a migration. Only admins may add a kind (28d).
Existing budgets migrate to `owner_kind = school` with their current `program_id`.

The picker is kind first, then the specific one, and it only offers schools that are
running or upcoming.

## 2. Team size

`outreach_budgets.team_size` — "Number of People on the Team". One field, visibly the
loudest thing on the screen (28a puts it in the yellow band with a stepper and a live
consequence line: *at 10 this budget becomes R68 150*).

Changing it must immediately update, with no page refresh:

- the People value on every line linked to team size
- those lines' totals
- every section subtotal
- the grand total and the per-person figure

Nobody edits twelve rows by hand because one person joined.

## 3. A budget line

```
outreach_budget_lines
  id, budget_id, section_id, sort_order,
  description, amount numeric, frequency int,
  uses_team_size bool, fixed_people int,
  imported_total numeric null,     -- what the sheet claimed
  source ('manual' | 'import'), import_batch_id null
```

**people** = `uses_team_size ? budget.team_size : fixed_people`
**total** = `amount × frequency × people` — always computed, never hand-entered.

`frequency` is a **bare number**. No unit labels — no days, nights, meals, weeks or
occurrences. The description carries the context: *Destination A – Food · R150 · 12 · 8
· R14 400*.

`uses_team_size` is editable after creation or import, individually or across a
selection.

## 4. Sections

`outreach_budget_sections (id, budget_id, name, sort_order)`. Add, rename, reorder,
move a line between them, delete one nothing uses, create during an import, or map an
imported name onto an existing one. Seed names: Variable Costs, Emergency Fund, Food,
Accommodation, Transportation, Ministry, Team Debrief, Team Fun, Vehicle Costs.

Section management is admin/finance only; it is not for ordinary team members.

## 5. The importer

Their sheet does not begin at row 1 and the description column has no heading. So:

**Find the header row** by scanning for a row containing Amount, Frequency, People and
Total. Never assume row 1. Then:

- the column **immediately before Amount** is the description, even with a blank heading
- everything above the header row is ignored (instructions, blank rows, a
  "Variable Costs" title)

**Parse rand.** `R14,400.00` → `14400`; `R1,000.00` → `1000`; `R0.00` → `0`. Strip the
symbol and thousands separators, keep decimals, store numerically, display as ZAR.

**Import every valid row below the header**, in original order. A valid row has a
description, amount, frequency, people and total.

Skip — but **show, greyed, with a reason**:

- blank spacer rows (they must not stop the import)
- rows with a total but no description
- the sheet's own final Total row
- subtotal rows

**Keep a described zero.** `Team Debrief – Accommodation · R0.00 · 1 · 8 · R0.00` is a
real line. Zero is not a skip signal; the description decides.

**Default the team-size link** by comparing the sheet's People value to `team_size`:
People == team_size → `uses_team_size = true`; People == 1 → fixed at 1. This is a
default the administrator can override per row or across a selection before confirming —
never a permanent decision made from a number in a file.

**Validate the arithmetic.** If `amount × frequency × people` ≠ the sheet's Total, flag
the row in the preview with four ways out: use our figure, correct the amount, correct
frequency or people, or skip the row. **Never silently overwrite a mismatched total.**

### Preview (28b)

Before anything is saved, state what was worked out — which row was the header, which
column was taken as the description, how many rows above were ignored, how currency was
read — then every row from the file with description, amount, frequency, people, sheet
total, our calculated total, team-size or fixed, and what will happen. Bulk actions
across ticked rows: mark as use team size, mark as fixed, put in a section, skip.

### Receipt (28c)

After the import, six counts (imported, ignored as blank, not budget lines, use team
size, fixed, warnings settled), where the lines went (sheet name → section, with NEW on
sections created during the import), **every skipped row by its spreadsheet row number
with what was seen and why**, and each settled warning with what the sheet said, what
was saved, and who decided. The file is retained; the whole batch is undoable for 24
hours via `import_batch_id`.

## 6. Manual entry

Lines can be added and edited by hand with the same fields, assigned to a section,
reordered and deleted. A new expense — vehicle hire, fuel, tolls, a surprise cost,
additional accommodation — never requires a developer.

## 6b. Spend and receipts (28e, 28f)

A budget is only half the module. `outreach_spend` records what actually left the
account; `receipts` holds the proof.

```
receipts
  id, budget_id, line_id null,       -- null = "needs a line"
  what_for text, amount numeric, spent_on date,
  paid_by_user_id, method ('card' | 'cash' | 'eft' | 'ffsa_card'),
  reimburse bool, reimbursed_at null,
  original_currency null, original_amount null, fx_rate null,
  file_path, file_name, file_size, mime,
  state ('unchecked' | 'checked'), checked_by null, checked_at null,
  created_at
```

- **Storage**: Supabase Storage bucket `receipts`, path
  `receipts/{budget_id}/{receipt_id}.{ext}`. Row-level policy: the payer and any
  admin/finance user can read; nobody can read another outreach's bucket path.
  Accept HEIC, JPEG, PNG and PDF; keep the original, generate a display-size copy.
- **`line_id` is nullable on purpose.** A photo taken in the field with no line
  attached must still save — it appears as `NEEDS A LINE` in the store and on the
  outreach's own attention band. Rejecting the upload means the receipt lives in
  someone's camera roll instead.
- **Foreign currency**: store what was on the slip plus the rate used; display ZAR.
  Everything totals in rand (there is no multi-currency in the Hub).
- **28e** shows each budget line as planned · spent · difference, with the receipt
  count on the line and a `NO PROOF` flag when money was spent with none attached.
  Over-spend is amber, under is green, an untouched line reads `—` rather than R0.
- **28f** is the store: filter chips (all / this outreach / no receipt / not yet
  checked / mine), free-text search across what-it-was-for, who paid and amount, and
  a right-hand drawer with the image, every field, who checked it, and
  move-to-another-line. `DOWNLOAD ALL AS ONE PDF` is what an auditor asks for.
- `checked_by` is a separate step from upload — uploading is for whoever spent the
  money, checking is finance's.

## 7. Permissions (28d)

One matrix, read by every budget screen. Admin and finance can do everything including
import, settle warnings, manage sections and change the owner; adding a *kind* of owner
is admin only. School leaders can edit lines and the team size but not import or manage
sections. Team leaders and members keep exactly the access they have today and gain
nothing automatically.

## 8. Migration — do not break what exists

- preserve every existing budget record, school assignment, description and total
- **never silently recalculate a historical budget**
- default `uses_team_size` sensibly (People == team_size → true, else fixed)
- never invent amount, frequency or people values that were not recorded
- historical totals change only when an authorised user edits the budget

## 9. Tests

Header-row detection · description-column detection with a blank heading · rand parsing
with commas · multi-row import (not just the first) · blank-row handling · final-total
handling · described zero retained · team-size linking and recalculation · fixed people
unchanged when team size changes · calculation validation · permission checks ·
existing-data migration.

Acceptance, in their words: R150 × 12 × 8 = R14 400; changing team size 8 → 10 makes it
R18 000; a line fixed at People = 1 does not move; category and overall totals update
immediately with no refresh; invalid rows never prevent valid rows importing.
