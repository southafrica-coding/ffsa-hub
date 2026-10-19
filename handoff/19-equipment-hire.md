# 19 · Equipment hire + asset register

Design: turns 44–47 in `handoff/FFSA Hub Redesign.dc.html`. Each frame is the element with that id, for example `id="47b"`. 45a–45c were drawn light; build them dark. Built on the vehicle rentals module
(103–106): same permission pattern, same PayFast provider, same Xero item-code route,
same inspection-photo storage.

Files in `handoff/equipment-hire/`:
- `110_equipment_hire.sql` is the schema, availability functions, RLS and buckets.
- `111_equipment_seed_auditorium.sql` holds the real Auditorium-Prayer Room tab: 95 units in 28 products, 5 in maintenance.
- `PROMPT.md` has four Claude Code prompts (K, L, M, N), run in order.

## The model in one paragraph

A **product** is what a customer sees: name, photos, price, deposit and listing. A **unit**
is one physical thing with a tag (AUD-0014), serial, condition, location and owner. Orders
book a **quantity of a product**. The warehouse attaches actual units by **scanning tags
while packing**. A unit counts toward availability only if its stored status is
`available`. `maintenance` and `retired` never count. The labels "reserved" and "out" are
never stored. They come from `equipment_order_units` through the view `equipment_unit_state`.

## Rules the code must keep

1. **A product is on the store only if** `is_listed AND can_leave_building AND price_day_cents IS NOT NULL`.
   A CHECK constraint enforces this. Importing never lists anything.
2. **Holding statuses:** requested, confirmed, prepping, out, returned. A quote holds nothing.
   A returned order holds its units until inspection, so nobody books gear that hasn't been checked.
3. **Availability is by calendar day, inclusive, worst day wins.** Use `equipment_free_count(product, from, to, ignore_order)`.
   The cart calls it with its own order ignored. A kit's availability is the minimum over its parts.
4. **Re-check on every date change** (46c). Lines that no longer fit are never removed silently. Each one offers
   a named fix: take fewer, swap for a similar product that is free, or remove. Checkout is blocked until every line is settled.
5. **One unit, one open order.** A partial unique index on `equipment_order_units (unit_id) WHERE returned_at IS NULL` enforces this.
6. **The scan is stopped** (47b-4) when the unit is in maintenance, retired, already open on another order,
   not a product on this order, the order already has enough of it, or the tag is unknown. Each case gets its own sentence.
7. **Check-in records each unit as fine, damaged or missing.** Damaged or missing opens an `equipment_maintenance` row,
   sets the unit to `maintenance` and proposes an `equipment_deductions` row. The rental manager confirms or waives it.
   The deposit refund is the deposit minus confirmed deductions.
8. **Late returns** propose a `late` deduction at the day rate for each late day. Same confirm step.
9. **Internal (ministry) orders** use `internal_day_cents` (usually 0), take no deposit, start as
   `requested` and wait for the rental manager. Damage is billed to the wing.
10. **Money** is stored in integer ZAR cents, excluding VAT. VAT is 15% (`equipment_settings.vat_bps`).
    Display uses `R 1 250.00` with a space as the thousands separator. Totals are snapshotted onto the order at confirmation.
11. **Payment:** PayFast takes two `equipment_payments` rows, hire and deposit, on one checkout.
    The deposit refund is a separate row. Email carries the amount, reference, bank details and the tokenised `/hire/o/[token]` link.
12. **Rate period:** Fri→Mon is one weekend. 5 to 7 days is a week. Anything else is day × days.
    Pick the cheapest period that covers the dates.

## Routes

Public, dark storefront, no login needed to browse:
- `/hire` is home (44b). `/hire/c/[slug]` is a category (46a, 47a-2). `/hire/p/[slug]` is an item (46b, 47a-3).
- `/hire/cart` (46c, 47a-4) and `/hire/checkout` (46d, 47a-5). The cart lives in localStorage and is re-checked on load.
- `/hire/o/[token]` is "my rental" without logging in (47a-6). `/hire/account` lists every order for a signed-in customer.
- `/t/[tag]` is where the QR code on every tag points. Staff are sent to the unit, and everyone else to the product page.

Staff, under `(admin)/bookings/equipment`, also dark (scope with `.theme-hire`):
- `/` is the dashboard (47c). `orders` and `orders/[id]` cover the lifecycle and approval (47d phone). `calendar` (47d).
- `gear` is the register (45b, 47e-1). `gear/[tag]` is one unit (45c, 47e-2). `gear/products/[id]` is the listing editor (47e-4).
- `maintenance` (47e-3). `import` (45a). `pricing` covers settings and per-product prices.
- `today`, `scan`, `orders/[id]/pack`, `orders/[id]/handover` and `orders/[id]/checkin` are the phone flow (47b).
  These must be built for phones first: bottom tab bar (Today · Scan · Orders · Gear · More), 44px or larger targets,
  a sticky bottom action bar, and camera scanning through `BarcodeDetector` with `@zxing/browser` as the fallback.

## Mobile

Every screen has a phone layout (47a–47e). The warehouse and approval screens are mainly used on phones.
The breakpoint is 768px. Below it: no side rail or panel, a bottom tab bar, tables become two-line rows
(name on top, a meta line under it), and the primary action sits in a sticky bottom bar.

## Screen map

| Screen | Frame | Route |
|---|---|---|
| Storefront home | 44b · 47a-1 | /hire |
| Category + date filter | 46a · 47a-2 | /hire/c/[slug] |
| Item + calendar | 46b · 47a-3 | /hire/p/[slug] |
| Cart conflict | 46c · 47a-4 | /hire/cart |
| Checkout | 46d · 47a-5 | /hire/checkout |
| My rental / ministry request | 46e · 47a-6 | /hire/o/[token] |
| Dashboard | 47c | /bookings/equipment |
| Calendar + conflict | 47d | /bookings/equipment/calendar |
| Order + approve | 47d phone | /bookings/equipment/orders/[id] |
| Today / pick / scan / hand over / check in | 47b 1–6 | /bookings/equipment/today, /scan, /orders/[id]/… |
| Import receipt | 45a | /bookings/equipment/import |
| Register | 45b · 47e-1 | /bookings/equipment/gear |
| Unit | 45c · 47e-2 | /bookings/equipment/gear/[tag] |
| Maintenance | 47e-3 | /bookings/equipment/maintenance |
| Listing editor | 47e-4 | /bookings/equipment/gear/products/[id] |

## Open decisions

- Real hire prices and deposits. Every price in the design is a sample.
- Which products may leave the building. The seed lists none. The dLive desk, the iMacs and the stage boxes probably never should.
- Whether ID verification is a real KYC provider or staff checking an ID at collection. The design assumes staff checking an ID at collection for now.
- Delivery pricing and area.
- The other 6 tabs of FFSA INVENTORY. Import each one through `/import` once it exists.
