# Equipment hire — Claude Code prompts

Unzip this into the root of the ffsa-platform repo. It puts these files in place:

- handoff/19-equipment-hire.md, the spec
- handoff/FFSA Hub Redesign.dc.html, the design. It replaces the old copy. Frames are the elements with id="44b", "47b" and so on.
- handoff/equipment-hire/110_equipment_hire.sql and 111_equipment_seed_auditorium.sql. Claude Code moves these into supabase/migrations under the next free numbers.

Before each prompt: `git checkout main && git pull`. Paste one prompt, check the result, then paste the next.

---

### K · Schema, seed and the register (read-only)

```
Read handoff/19-equipment-hire.md, then supabase/migrations/103_vehicle_rentals.sql
and 105_vehicle_payments.sql so you copy their patterns.
Design frames are in handoff/FFSA Hub Redesign.dc.html: search for id="<frame>" (for example id="47b").

Branch: feature/K-equipment-schema.

1. Move handoff/equipment-hire/110_*.sql and 111_*.sql into supabase/migrations under the
   next two free numbers (keep the order, and update the "Requires migration 110" comment).
   Apply them through Supabase the way earlier migrations were applied. Check the seed gives 95 units, 28 products and 5 units in maintenance.
2. Write src/services/equipment.ts in the style of src/services/vehicles.ts: types for every
   table, getEquipmentAccess(), listProducts(), getProductBySlug(), listUnits(),
   getUnitByTag(), freeCount(productId, from, to, ignoreOrderId?) calling the SQL function,
   freeByDay(), and freeCountForKit() (min over parts, and say which part ran out).
   Add a rands(cents) formatter that returns "R 1 250.00", with a space as the thousands separator.
3. Add the Equipment module to the bookings area next to Vehicles, gated by
   has_equipment_access. Build /bookings/equipment/gear (frame 45b) and
   /bookings/equipment/gear/[tag] (frame 45c): products in a table, clicking one shows its units,
   unit page with history from equipment_events. Read-only for now.
4. Wrap every /bookings/equipment page in a .theme-hire class with the dark tokens:
   bg #100E0B, surface #17140F / #1B1814, line #2A251E / #2F2A22, ink #F6F0E2,
   body #CFC6B4, muted #8C8273, accent #FFB801, ok #9CC48A. Bebas Neue for display text.
   Don't change the rest of the Hub.
5. Below 768px: no side panel, bottom tab bar (Today · Scan · Orders · Gear · More),
   table rows become two-line rows, 44px+ targets. Match frames 47e-1 and 47e-2.

Show me the register on my phone before you continue.
```

---

### L · Listing editor, pricing and the public storefront

```
Read handoff/19-equipment-hire.md (rules 1, 3, 4, 10, 12).
Design frames are in handoff/FFSA Hub Redesign.dc.html: search for id="<frame>" (for example id="47b").

Branch: feature/L-equipment-storefront.

1. /bookings/equipment/gear/products/[id] is the listing editor (frame 47e-4): can leave the
   building, day / weekend / week price, deposit, ministry rate, photos (bucket
   equipment-photos), what's included, specs, store category, "Go live". Block going live
   unless the CHECK constraint would pass, and say why in plain words.
2. /bookings/equipment/pricing edits equipment_settings (VAT, waiver %, waiver cover,
   deposit refund days, agreement version, Xero item code).
3. Public routes under src/app/(public)/hire: home (44b / 47a-1), category with the date
   filter (46a / 47a-2), item with the month calendar from freeByDay (46b / 47a-3).
   Only listed products. Sort free first, then partly free, then booked with
   "Free from <date>". Skeletons while loading. An empty category says so plainly (46e left).
4. src/lib/equipment/pricing.ts is a pure function quote(lines, from, to, kind, settings) giving
   period, per-line price, subtotal, waiver, VAT, total and deposit. Fri→Mon = weekend,
   5–7 days = week, otherwise days × day rate, using the cheapest period that covers the dates.
   Internal orders use internal_day_cents and take no deposit. Write unit tests for it.
5. /t/[tag] sends staff to the unit page and everyone else to the product page.

Design is dark throughout. Phone layouts match 47a. Show me the item page on my phone.
```

---

### M · Cart, checkout, PayFast and ministry requests

```
Read handoff/19-equipment-hire.md (rules 2, 4, 9, 10, 11) and copy
Design frames are in handoff/FFSA Hub Redesign.dc.html: search for id="<frame>" (for example id="47b").
src/app/api/vehicles/payments/route.ts + api/integrations/payfast/vehicle-notify/route.ts.

Branch: feature/M-equipment-checkout.

1. Cart in localStorage: { from, to, fulfilment, lines[] }. On load and on every date change,
   re-check each line with freeCount. A line that no longer fits shows the named fixes from
   frame 46c: take N, swap for a similar free product in the same store category at about the
   same price, or remove. Checkout stays disabled until every line is settled.
2. /hire/checkout is one page with five steps (46d / 47a-5): details, ID (staff check at
   collection for now: collect the ID number and say so), collection or delivery, agreement
   (summary + full text + tick + typed name, store agreement_version), pay.
3. POST /api/equipment/checkout: in one transaction, re-check availability with a row
   lock on the product, create the order (status confirmed once paid; pending payment
   until then), lines and two equipment_payments rows (hire, deposit), then start PayFast.
   Add /api/integrations/payfast/equipment-notify, which marks payments paid, moves the order to
   confirmed, sends the confirmation email with the /hire/o/[token] link, and creates the
   Xero invoice like vehicles do.
4. Ministry wings: anyone with equipment.request signed in sees the internal rate on the
   item page. Their checkout skips payment and creates status requested (46e right).
   /bookings/equipment/orders/[id] lets equipment.manage approve or decline (47d phone).
   Email either way.
5. /hire/o/[token] is "my rental" (47a-6): status run, return time, units once packed,
   Extend (re-checks availability), Report an issue, Invoice.

Test with the PayFast sandbox. Show me a full checkout on my phone.
```

---

### N · Warehouse phone flow, maintenance, calendar, dashboard

```
Read handoff/19-equipment-hire.md (rules 5–8). Copy the photo upload from
Design frames are in handoff/FFSA Hub Redesign.dc.html: search for id="<frame>" (for example id="47b").
src/app/(admin)/bookings/vehicles/inspection-form.tsx.

Branch: feature/N-equipment-ops.

Build these for phones first. They will mostly be used on a phone in the warehouse.

1. /bookings/equipment/today (47b-1): going out and coming back today, plus one yellow band
   for the most urgent late order.
2. /orders/[id]/pack (47b-2): lines grouped by location, "any 2 of AUD-0070–0073", count,
   untagged extras listed under the lines.
3. /scan (47b-3) uses BarcodeDetector with an @zxing/browser fallback and a "type an ID"
   option. Scanning inside an order inserts equipment_order_units. Stop the scan and explain
   (47b-4) for: maintenance, retired, open on another order (say which and who), not on this
   order, already enough, unknown tag. Scanning outside an order opens the unit.
4. /orders/[id]/handover (47b-5): photos (bucket equipment-inspections), an ID checkbox and a
   signature canvas saved as a PNG file. This sets handed_over_at and order status out.
5. /orders/[id]/checkin (47b-6): fine / damaged / missing per unit. Damaged or missing
   requires a note and a photo, opens equipment_maintenance, sets the unit to maintenance and
   proposes a deduction. Saving sets returned_at and order status returned.
   The manager confirms deductions on the order, which moves it to inspected, and refunds the
   deposit minus confirmed deductions, which moves it to closed.
6. /maintenance (47e-3): reported, at repairer, done. Done sets the unit back to available.
   Retiring a unit asks for a reason.
7. /calendar (47d): one row per product with bars per order, a count over the bar showing
   "N of M", maintenance spans and conflicts outlined in yellow with the reason and actions.
8. /bookings/equipment (47c): income, out now, out and back today, overdue, in maintenance,
   how busy each category is, maintenance due, most and least rented. One yellow band only.
9. A cron (copy the pattern of existing crons in vercel.json) proposes late deductions
   and emails a reminder the morning a return is due.

Show me pack → scan → hand over → check in on my phone with a seeded test order.
```
