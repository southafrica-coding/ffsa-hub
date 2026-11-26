# Hub Store build report

**PR:** https://github.com/southafrica-coding/ffsa-hub/pull/730 (draft, into `main`, not merged)
**Branch:** `feat/ffsa-store` (from `origin/main` at `b517b4fb`)

## ⚠️ Decision for Jack: where to apply migration 412

`supabase/migrations/412_store.sql` is **not applied anywhere**. I didn't run it against any project.

Vercel previews share the **production** database (`thodakhvkcodfystnkxa`). So the Store, including on a preview, works only after 412 has been applied to that database. It is additive and safe to run there:

- New `store_*` tables with RLS.
- Two permission rows (`store.view`, `store.manage`), granted to nobody.
- Three **private** buckets (`store-source`, `store-pages`, `store-covers`).
- **No** product, order or user rows.

Whether and when to apply it is your call. Until then, `/store` shows "can't load" and `/store/admin` says 412 isn't applied.

## Built

- **Public storefront** `/store`, product pages with a flipbook preview, cart and checkout, thank-you / EFT page, and redeem.
- **Payments:**
  - PayFast **sandbox** card checkout through the existing `src/lib/payments/payfast.ts`.
  - A Store ITN route (`/api/integrations/payfast/store-notify`): signature, postback, amount check, idempotent settle.
  - EFT: a pending order, bank details, proof upload, and Media's "Mark EFT paid".
- **Buyers:**
  - Magic-link sign-in. Buyers get no `users` row or roles, and middleware keeps them out of staff pages and APIs.
  - **My Library** flipbook: signed page URLs that expire after 10 minutes, a per-buyer watermark, offline reading through a service worker, and 3 devices max with a Devices tab.
  - Orders page with pack codes.
- **Gifts and group code packs**, with single-use codes.
- **Print + Digital**: a per-buyer low-res watermarked PDF behind a 120-second signed URL. Digital and subscription buyers get flipbook only.
- **Resend my purchases**: one email with every paid purchase and a sign-in link. The answer is always neutral. Limits are 3 per email and 10 per IP, per hour.
- **Admin** `/store/admin`:
  - `store` module, gated by `store.manage` / `store.view`; admins get it automatically.
  - Products as data, cover upload, sizes and stock.
  - **PDF upload**: private bucket, then rendered to WebP pages, then a preview-page picker.
  - Orders, fulfilment steps (preorder → to pack → shipped/ready → delivered/collected), cancel, CSV export, and a "To do" band.
- **Emails:** confirmation, EFT details, gift, fulfilment, Media notice, sign-in and purchases. All are behind `STORE_EMAILS_ENABLED` (default off).

## Stubbed / not done

- Paystack, refunds and live PayFast. The Store refuses live PayFast unless `STORE_PAYFAST_ALLOW_LIVE=1`.
- The Services seam is left as `TODO(services)` (module config and migration). Nothing is granted to Media automatically.
- `database.ts` is not regenerated. The Store uses hand-written types and `storeAdminClient()` until 412 is applied.
- Rendering runs inside the request (`maxDuration` 300). A very large PDF may need a background job.

## Tests

- `npx tsc --noEmit`: **0 errors**.
- `npx vitest run` on the full suite: **4,278 passed, 5 failed, 10 skipped**.
  - The 5 failures also fail on untouched `HEAD` (I checked in a throwaway worktree). They are the duplicate `398_*` migration checks (×2), fleet `fmtR` locale formatting, a fleet model date test, and fleet parity. None touch Store files.
- Store and middleware tests: **107 passed**. They cover:
  - catalogue as data
  - cart/checkout
  - entitlements
  - RLS/auth isolation (migration SQL plus routes: a buyer vs `store.manage` vs `store.view`)
  - ITN signature and sandbox/flag behaviour
  - gifts and code packs
  - merch stock, variants and fulfilment
  - the device limit
  - signed URL expiry and tampering
  - the watermark pipeline on the sample PDF
  - Resend my purchases
  - middleware buyer isolation
- Local note: this Mac's Node 22.11 needs `NODE_OPTIONS=--experimental-require-module` to load vitest 4's config. That's unrelated to this PR.

## Screenshots (390×844, untracked)

`~/code/ffsa-hub-store/tmp/store-shots/`:

- `1-storefront.png`
- `2-product-flipbook.png`
- `2b-product-merch.png`
- `3-checkout.png`
- `4-library-signin.png`
- `wm-p2.png` (a watermarked sample page)

They were taken against a **local mock** of the Supabase REST and storage endpoints serving fake fixture products and the rendered sample PDF. No real database, no `.env.local` copied, no credentials. No page scrolls sideways at 390px.

## Testing with your own PDF

1. Apply 412 to the database you'll test against (see the decision above).
2. Set `STORE_SIGNING_SECRET` (16+ random characters). For checkout, also set `STORE_PAYMENTS_ENABLED=1` and either the sandbox `PAYFAST_*` values or the four `STORE_EFT_*` values.
3. Go to `/store/admin` → **New product**. Title "Year-End Review 2026", kind **Digital** (or **Print + Digital**), price. Create it (it starts as a Draft).
4. On the product page:
   - **Upload cover**.
   - **Upload PDF** with your Review. Wait for "Flipbook ready: N pages".
   - Pick the preview pages, then **Save preview pages**.
5. Set Status to **Published** and Save. It appears on `/store`, and `/store/p/year-end-review-2026` shows the preview.
6. Buy it with your own email.
   - EFT: open the order in `/store/admin` and **Mark EFT paid**.
   - PayFast sandbox: pay with the sandbox wallet. The ITN marks it paid.
7. Go to `/store/library` and **Email me a sign-in link**. With `STORE_EMAILS_ENABLED` off the email is only logged, so turn it on for this step. Then open the flipbook and check the "Licensed to …" watermark. For Print + Digital, check **Your PDF**.
8. To replace the PDF later, upload again. The new flipbook replaces the old one for everyone.

The fake sample is `src/lib/store/fixtures/sample-review.pdf`. Rebuild it with `node scripts/store/make-sample-pdf.mjs`.

## Env vars (names only)

`STORE_PAYMENTS_ENABLED`, `STORE_EMAILS_ENABLED`, `STORE_SIGNING_SECRET`, `STORE_MEDIA_NOTIFY_EMAIL`, `STORE_PAYFAST_ALLOW_LIVE` (leave unset), `STORE_EFT_BANK`, `STORE_EFT_ACCOUNT_NAME`, `STORE_EFT_ACCOUNT_NUMBER`, `STORE_EFT_BRANCH_CODE`.

Existing ones the Store also uses: `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_MODE=sandbox`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`.
