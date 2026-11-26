# Hub Store build report

**PR:** https://github.com/southafrica-coding/ffsa-hub/pull/730 (draft, into `main`, not merged)
**Branch:** `feat/ffsa-store` (from `origin/main` at `b517b4fb`)

## ⚠️ Decision for Jack: where to apply migration 412

`supabase/migrations/412_store.sql` is **not applied anywhere**. I didn't run it against any project.

Vercel previews share the **production** database (`thodakhvkcodfystnkxa`). So the Store, including on a preview, works only after 412 has been applied **somewhere the app points at**: either prod, or a separate Supabase project whose keys you put on a preview. It is additive and safe to run on prod:

- New `store_*` tables with RLS.
- Two permission rows (`store.view`, `store.manage`), granted to nobody.
- Three **private** buckets (`store-source` 50 MB cap, `store-pages`, `store-covers`).
- **No** product, order or user rows.

Whether and where to apply it is your call. Until then, `/store` shows "can't load" and `/store/admin` says 412 isn't applied.

412 changed in this follow-up (still unapplied, so I edited it in place rather than adding 413):
- `store_assets` gains `filename`, `byte_size` (≤ 50 MB), `render_started_at`, and an `awaiting_upload` status.
- The `store-source` bucket's `file_size_limit` is now 50 MB (was 150 MB).

## PDF uploads: signed, straight to Storage (don't "simplify" this)

**Vercel caps a serverless function's request body at 4.5 MB.** Your test draft is 21.9 MB, so any route that receives the file (FormData, `req.arrayBuffer()`) fails on Vercel with `413 FUNCTION_PAYLOAD_TOO_LARGE`, even though it works on localhost. So the PDF never passes through a Hub route:

1. `POST /api/store/admin/products/[id]/pdf`: **JSON only** `{ filename, contentType, size }`. Needs `store.manage`. Checks the name ends in `.pdf`, the type is `application/pdf`, and the size is 1 byte to **50 MB** (413 over that). Records an `awaiting_upload` asset and returns a short-lived Supabase **signed upload token** for the private `store-source` bucket. The storage path is ours (`<product>/<asset>.pdf`), never the file name.
2. The browser **PUTs the PDF straight to Supabase Storage** with that token. The bucket's own 50 MB limit backs up the API's.
3. `POST /api/store/admin/assets/[id]/complete` (JSON, no body). Checks that the object really landed and is the size that was signed for. Claims the asset once (a double-click gets 409), then **renders in the background** with `after()` and answers `202` straight away.
4. The admin page polls `GET /api/store/admin/assets/[id]` and shows "N pages so far" until it's ready or failed.
5. `POST /api/store/admin/assets/[id]/render` is the retry. It runs the same job, and can take over a render that died on the function timeout after 6 minutes.

Rendering keeps the source PDF in memory (pdfjs needs it whole; ≤ 50 MB). Pages render **one at a time** and are uploaded as they finish, page rows are written in batches of 5, and only one page image is held at once. The bucket stays private. The limits and the reason live in `src/lib/store/upload.ts`, the route comments and `.env.local.example`.

## Jack's real PDF, run locally (not uploaded anywhere)

There's no `.env.local` here, so I didn't start against a real Supabase project. I ran the **real route handlers** with the **real `supabase-js` storage client** against a **local Storage stand-in**: a small HTTP server that speaks Supabase's storage API and keeps files in a temp folder (`src/lib/store/testing/local-storage.ts`), plus the in-memory DB the Store tests already use. Nothing went to prod and no credentials were used or invented. The PDF stayed at `/Users/ffsaimac2/code/store-test/jack-draft.pdf` and was never copied into the repo.

`jack-draft.pdf`, 22,972,092 bytes, Node 22 on this Mac (M-series):

| Step | Result |
|---|---|
| Sign-url API | 21.9 MB accepted (limit 50 MB) |
| Signed PUT to Storage | 42 ms (local loopback; a real upload depends on your connection) |
| Render → WebP pages | **35 pages in 9.9 s** (~0.28 s a page) |
| Rendered pages total | 3.26 MB (2 portrait pages at 1080×1527, 33 landscape spreads at 1620×1146) |
| Watermarking one page for a buyer | ~127 ms |
| Print + Digital low-res watermarked PDF | 35 pages, **1.80 MB**, built in 2.9 s |
| Peak memory (whole test process) | ~1.03 GB RSS, from ~0.64 GB at the start: ~400 MB for the render |

That fits Vercel's limits comfortably: `maxDuration` 300 s on the complete/render routes, and the default function memory.

What your PDF taught the code:
- **Most of its pages are two-page spreads saved as one landscape page.** The flipbook used to pair pages two-up on wide screens, which would have put two spreads side by side. Now a landscape page always shows alone, and every page keeps its own shape (`buildSpreads`, tested). Landscape pages render 1.5× wider (1620 px), so each half stays sharp.
- **The pages are mostly dark photography**, and the diagonal "Licensed to …" repeat was dark ink only, so it was invisible on them. It now has a faint light outline too, so it shows on dark and light pages. The footer tab was already legible.

Local outputs (gitignored under `tmp/`): `tmp/store-local-pdf/report.json`, `watermarked-p1..3.webp`, `buyer-low-res-watermarked.pdf`, and `pages/` (the clean renders).

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
  - **PDF upload**: signed direct-to-Storage upload (50 MB max), background render to WebP pages with progress, then a preview-page picker.
  - Orders, fulfilment steps (preorder → to pack → shipped/ready → delivered/collected), cancel, CSV export, and a "To do" band.
- **Emails:** confirmation, EFT details, gift, fulfilment, Media notice, sign-in and purchases. All are behind `STORE_EMAILS_ENABLED` (default off).

## Stubbed / not done

- Paystack, refunds and live PayFast. The Store refuses live PayFast unless `STORE_PAYFAST_ALLOW_LIVE=1`.
- The Services seam is left as `TODO(services)` (module config and migration). Nothing is granted to Media automatically.
- `database.ts` is not regenerated. The Store uses hand-written types and `storeAdminClient()` until 412 is applied.
- The render runs in `after()` inside the complete route's invocation (300 s budget), not in a separate job queue. Your 35-page draft takes ~10 s. A PDF that needs more than ~5 minutes would need a queue, which is not built.
- The signed PUT hasn't been tried against real Supabase Storage yet. That needs 412 applied somewhere; the local stand-in follows storage-js's own requests.
- Cover images still upload through a route. They're capped at 5 MB by the bucket and are small. If a cover over 4.5 MB ever matters, move it to the same signed flow.

## Tests

- `npx tsc --noEmit`: **0 errors**.
- `npx vitest run` on the full suite: **4,287 passed, 6 failed, 11 skipped**.
  - 5 of the failures also fail on untouched `HEAD` (I checked in a throwaway worktree on the first pass). They are the duplicate `398_*` migration checks (×2), fleet `fmtR` locale formatting, a fleet model date test, and fleet parity.
  - The 6th, `sidebar-access` "at most four round trips", is a latency-timed test (20 ms simulated round trips). It failed under full-suite load and passed on its own three times in a row. It doesn't touch Store code.
  - None of the 6 touch Store files.
- Store tests include the new `upload-flow.test.ts` (10 run in CI, 1 local-only):
  - Upload rules: 21.9 MB accepted; over 50 MB gets 413; not-a-PDF gets 400. The sign API refuses `store.view`, buyers and signed-out users.
  - Storage refuses a PUT over the bucket limit.
  - `complete` fails an upload whose stored size doesn't match, and one that never finished.
  - Flipbook spread rules.
  - The **full flow on the small sample**: sign, signed PUT, complete (202, and a double-click gets 409), background render, active asset, preview pages, the buyer's watermarked page through `/api/store/page`, and the buyer's Print + Digital PDF through the library route and a signed URL.
  - The same flow on a **real PDF**, only when `STORE_LOCAL_PDF` is set. It's skipped in CI and never needs your file.
- Local note: this Mac's Node 22.11 needs `NODE_OPTIONS=--experimental-require-module` to load vitest 4's config. That's unrelated to this PR.

## Screenshots (390×844, untracked)

`~/code/ffsa-hub-store/tmp/store-shots/`. The `jack-*` shots use your real PDF's rendered pages:

- `jack-1-storefront.png`: cover from your PDF
- `jack-2-product-flipbook-cover.png`, `jack-2b-product-flipbook-spread.png` (page 2, a landscape spread, preview-stamped), `jack-2c-product-full.png`
- `jack-3-checkout.png`, `jack-3b-checkout-full.png`
- Earlier pass, on the fake sample: `1-storefront.png`, `2-product-flipbook.png`, `2b-product-merch.png`, `3-checkout.png`, `4-library-signin.png`, `wm-p2.png`

They were taken with `next dev` against a **local mock** of Supabase's REST and storage endpoints (fake products, your rendered pages). There was no real database and no credentials. None of the pages scrolls sideways at 390 px (checked as 0 px overflow).

## How Jack tests with this PDF

**Locally, no database needed:**

```bash
STORE_LOCAL_PDF=/Users/ffsaimac2/code/store-test/jack-draft.pdf \
NODE_OPTIONS=--experimental-require-module \
npx vitest run src/lib/store/__tests__/upload-flow.test.ts
```

This runs sign → signed PUT → complete → render → watermark → buyer PDF on your file. It writes timings and outputs to `tmp/store-local-pdf/` (gitignored).

**In the real Hub** (after 412 is applied to the database the app uses):

1. Set `STORE_SIGNING_SECRET` (16+ random characters). For checkout, also set `STORE_PAYMENTS_ENABLED=1` and either the sandbox `PAYFAST_*` values or the four `STORE_EFT_*` values.
2. Go to `/store/admin` → **New product**. Title "Year-End Review 2026", kind **Digital** (or **Print + Digital**), price. Create it (it starts as a Draft).
3. On the product page:
   - **Upload cover**.
   - **Upload PDF** with `jack-draft.pdf`. It goes straight to Storage, then the page shows "Making pages…" with a page count. Expect "Flipbook ready: 35 pages" within about a minute.
   - Pick the preview pages, then **Save preview pages**.
4. Set Status to **Published** and Save. It appears on `/store`, and `/store/p/year-end-review-2026` shows the preview.
5. Buy it with your own email.
   - EFT: open the order in `/store/admin` and **Mark EFT paid**.
   - PayFast sandbox: pay with the sandbox wallet. The ITN marks it paid.
6. Go to `/store/library` and **Email me a sign-in link**. With `STORE_EMAILS_ENABLED` off the email is only logged, so turn it on for this step. Then open the flipbook and check the "Licensed to …" watermark. For Print + Digital, check **Your PDF**.
7. To replace the PDF later, upload again. The new flipbook replaces the old one for everyone.

The fake sample is `src/lib/store/fixtures/sample-review.pdf`. Rebuild it with `node scripts/store/make-sample-pdf.mjs`.

## Env vars (names only)

`STORE_PAYMENTS_ENABLED`, `STORE_EMAILS_ENABLED`, `STORE_SIGNING_SECRET`, `STORE_MEDIA_NOTIFY_EMAIL`, `STORE_PAYFAST_ALLOW_LIVE` (leave unset), `STORE_EFT_BANK`, `STORE_EFT_ACCOUNT_NAME`, `STORE_EFT_ACCOUNT_NUMBER`, `STORE_EFT_BRANCH_CODE`.

Existing ones the Store also uses: `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_MODE=sandbox`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`.

No new env var for uploads. The 50 MB cap is a constant (`MAX_PDF_BYTES`) and the bucket limit in 412.
