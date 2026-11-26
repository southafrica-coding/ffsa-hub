# Store coupons — screenshots

All four shots were captured locally at a 390 px viewport (`deviceScaleFactor` 2) from HTML mocks of the real admin and checkout layouts, with made-up names only (`WELCOME20`, `FREEGIFT`, “Autumn preview”). No production data, no preview login. After each load, `document.documentElement.scrollWidth === 390` was checked and held.

The capture script and mocks live outside the repo (`~/code/hb1-notes/sqltest/shots`).

| File | What it shows |
| --- | --- |
| `01-admin-coupon-list.png` | `/store/admin/coupons` on a phone: cards with code, discount, product, uses, end date and the on/off control |
| `02-admin-coupon-form.png` | `/store/admin/coupons/new`: code, note, percent or rand off, product, max uses, last day, on |
| `03-checkout-partial.png` | `/store/checkout` with `WELCOME20` applied: the code, Subtotal, the discount line, and the reduced Total |
| `04-checkout-free.png` | `/store/checkout` with `FREEGIFT` applied: “Nothing to pay”, the covered-order notice, and Complete order |
