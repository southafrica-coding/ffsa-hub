# Going live with two schools already running

The billing system must not be something you have to retrofit onto schools that are
half-finished. Nothing here requires touching an in-flight school.

---

## The switch: `billing_mode` on the program

Add one column to `programs`:

| Mode | What the Hub does |
|---|---|
| `external` | Nothing. No schedules, no generation, no runs, no reminders. Fees are invisible in the Hub, or shown as manually-entered read-only numbers. Xero stays the only record. |
| `hub_scheduled` | Everything in `07-finance-billing.md`. |

Default new programs to `hub_scheduled`. Set the two running schools to `external` and
the entire finance apparatus leaves them alone. Every finance screen filters on this —
a school in `external` mode does not appear in the invoice run, the debtors report, or
the reminder queue, and its students' fee tabs say so plainly rather than showing zeros.

**This is the answer to "can we not use any of it yet": yes. Two rows.**

---

## The middle path, if one school has months left

For a school with real time remaining, going `external` means hand-invoicing for
another six months. The alternative is a partial adoption that never looks backwards:

Add `schedule_start_date` to the program. The Hub then:

- builds charges only for periods **due on or after** that date
- takes everything before it as history — either not represented at all, or entered
  once as a single opening-balance line per student
- never generates, emails or chases anything dated before it

The generation guard from `07-finance-billing.md` already makes this safe: seeding a
running school's fee structure today produces a *decision queue*, not a batch of
backdated invoices. If you seed a school mid-flight and do nothing else, the outcome
is a list to dismiss — not money demanded from students.

---

## What we would actually do

**The school that is nearly finished** — `external`. Do not migrate it. It has a handful
of payments left and they are already tracked somewhere that works.

**The school with months to run** — `hub_scheduled` with `schedule_start_date` set to
go-live. Enter one opening balance per student, keep issuing the remaining months from
the Hub. You get reminders, receipts and the debtors view for the part that is still
ahead of you, and you never have to reconstruct the part behind you.

**The next school to start** — full `hub_scheduled` from the fee structure onwards.
This is the one that proves the system, because it is the only one where the Hub has
been there from acceptance.

---

## Sequencing so nothing goes out by accident

1. Ship with `billing_mode` defaulting to `external` for **every existing** program.
   New programs default to `hub_scheduled`.
2. Build the fee structure for the next school while the two current ones are untouched.
3. Keep **email sending off** at the school level until someone has read a real
   generated invoice end to end (18b dry run → 21b preview → their own inbox).
4. Only then decide whether the mid-flight school moves to `hub_scheduled`.

A school-level "sending is off" flag is worth having permanently. It is the difference
between a mistake being a mistake and a mistake being 24 emails.

---

## Opening balances

If you adopt mid-flight, the cleanest representation is one charge per student:

- label: `Balance carried over`
- amount: what she owed on go-live day
- due anchor: `fixed_date`, set to go-live
- generation: `immediate`
- item code: a dedicated `CARRIED` code per organisation

It behaves like any other charge, appears on her fee tab, ages in the debtors report,
and needs no special case anywhere in the code.
