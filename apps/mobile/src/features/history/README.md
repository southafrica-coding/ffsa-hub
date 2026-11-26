# My History (read-only)

Route: `app/(app)/history/` — a hidden route of the signed-in tabs (not in `TABS`), opened from the Home "My History" shortcut or a Home feed item linking `/my-history`.

| Screen | Route | Web equivalent |
|---|---|---|
| My History | `/history` | `/my-history` |
| Record detail | bottom sheet on `/history` | the row's disclosure ("Additional details", "Open file") |

**Who sees it.** Every signed-in person, as on the website (module `my-history`, portal group, no role gate). There is nothing to gate: RLS only returns a person's own linked rows.

**Data.** Plain reads straight from Supabase with the person's own session (`data.ts`): the same four queries as `getUserHistory` in `src/services/records-library.ts`, which the web page runs with the user's client. RLS (`"Users can read own library …"`, migration 061, kept by 212) allows `user_id = auth.uid()`. Every read is also filtered to the caller's `user_id` (Records Library admins, whose RLS shows every row, still see only their own here), and columns are listed rather than `*` so import bookkeeping (`person_id`, `import_id`, `content_hash`) never reaches the phone. No endpoint, no writes, no migration.

Unlike the web (which renders whatever reads succeeded), any failed read is an error state with a retry, so a missing section is never mistaken for "nothing on file".

**Offline.** The last good copy is kept with finance's `useCachedLoad` (encrypted store, per user) and shown at once with "Last updated …".

**Files.** A document's `file_url` opens in the in-app browser (`openWebPage`), only when it is an `http(s)` URL or a website path; nothing is downloaded into the app.

**Not here.** The Records Library admin pages and the match queue stay on the website.

**Look (redesign, frames 9.1–9.4).** The screen draws its own header with the kit's `LargeTitleScrollView` (back to Home; the stack has `headerShown: false`). Each section is a counted heading over a kit `ListGroup`; the record opens in the shared kit `Sheet`. The few pieces the kit doesn't have yet are shared with My Schools (`features/schools/components/parts.tsx`). Payments keep the imported currency text with cents (`formatAmount`: "ZAR 12,450.00"), not the app's `formatMoney`.
