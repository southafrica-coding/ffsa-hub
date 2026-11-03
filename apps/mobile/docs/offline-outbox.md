# Offline outbox: how saved-but-unsent work is kept safe

People capture receipts, vehicle-check photos and door check-ins with poor
signal. Three queues keep that work on the phone until FFSA Hub has it. This
page is the audit of all three (Phase 2, batch 3, "outbox hardening"): what
each one stores, what happens in every failure case, which server calls are
safe to repeat, and which gaps were fixed.

The promise: **nothing is lost, nothing is sent twice, and it is always clear
when something needs the person.**

## The three queues at a glance

| | Finance outbox | Vehicle-check outbox | Door check-in queue |
|---|---|---|---|
| Code | `src/features/finance/outbox/**` | `src/features/bookings/outbox/**` | `src/features/tickets/offline-queue.ts` (+ `use-door.ts`) |
| What is queued | Outreach expenses; receipt photos | Vehicle collection/return photos; the check form | Ticket codes scanned or typed at a door while offline |
| Stored where | `Documents/finance-outbox/queue.json` + photo files | `Documents/bookings-outbox/queue.json` + photo files | AsyncStorage key `ffsa.tickets.checkin-queue.v1:<userId>` |
| Format | `{ "version": 2, "items": [...] }` (v1 = bare array, still read) | same | same (v1 = bare array, still read) |
| Engine | Shared: `src/lib/outbox/engine.ts` | Shared: `src/lib/outbox/engine.ts` | Own reducer (per-event, per-door); shared backoff, wording and notices |
| Runs when | App-wide (signed-in area): on open, reconnect, return to foreground, backoff timer | While Bookings is open: same triggers | While that event's door is open: on reconnect, on return to foreground, on a backoff timer, on "Send now" |
| Shown where | Team screen + expense screen (`OutboxList`) | Bookings home, vehicle detail, inspection (`QueueList`) | Door screen banners |

## Shared core (`src/lib/outbox/`)

| File | What it does |
|---|---|
| `backoff.ts` | 2 s, 4 s, 8 s … capped at 5 min, with "equal jitter" (half to all of the delay). Obeys a server's `Retry-After` (up to 1 h). `MAX_ATTEMPTS` = 8. 408/425/429/5xx count as worth retrying. |
| `queue.ts` | The pure state machine (waiting → sending → removed / waiting / failed). Mid-send items can't be retried or removed. Reconnect/foreground never retries an item within 5 s of its last try and never skips a `Retry-After`. |
| `persist.ts` | Versioned format; reads v1; keeps every item it can read and reports `corrupt` / `partial` instead of returning an empty queue. |
| `file-store.ts` | Writes `queue.json.tmp` then renames it over `queue.json`; reads the `.tmp` if the very first write was interrupted; copies an unreadable file to `quarantine-<time>.json`; tidy-up never touches queue or quarantine files. |
| `engine.ts` | The send loop: one item at a time, disk written after every change, sends only for the signed-in owner, "already there" counts as sent, 24-hour tidy-up of photos nobody queued. |
| `retry-after.ts` | Wraps `fetch` so a 429/503 `Retry-After` reaches the outbox (the shared request helpers drop headers). |
| `use-pump.ts` | The provider hook: send on mount, on reconnect (not on every NetInfo event), on return to the foreground, and on one timer for the next retry. |
| `status.ts`, `strings.ts`, `OutboxStatus.tsx` | One state per item in words, the reason with a next step, "Last tried 14:05", the "2 waiting · 1 needs you" count, and the damaged-store notice. |

### The states a person sees

| State | When | What the line under it says |
|---|---|---|
| **Waiting for signal** | Waiting, phone offline | Saved on this phone. It will send by itself when you have signal. |
| **Waiting to try again** | Waiting, online, between tries | The last problem (if any), then "It will try again by itself." |
| **Sending…** | On the wire (Retry and Remove are hidden) | Sending now. Keep the app open if you can. |
| **Needs you** | Refused by the server, a photo is missing, or 8 tries failed | The specific reason, then "Tap Retry …, or Remove …" (or "Couldn't send after 8 tries. Check your signal, then tap Retry."). |
| Sent | It's on FFSA Hub | The item leaves the list and the server's copy appears in its place (the expense in the team list, the check as recorded). The door says "Checked in" through its usual verdict. |

Status is never colour alone: every state is a word, the needs-you label has a
heavier border, and each row reads as one sentence to VoiceOver/TalkBack.
Remove always asks first.

## Finance outbox (expenses + receipts)

| Situation | What happens | Status |
|---|---|---|
| Queued | Expense id is a UUID chosen when the form is saved (`ExpenseScreen`, `Crypto.randomUUID()`); a receipt's storage path is fixed when queued. Written to disk before any send. | Already true |
| App killed mid-send | On restart the item is back to "waiting" (flagged maybe-sent) and sent again; both calls are safe to repeat (below). | Already true; flag added |
| Restart | Queue read back from disk; v1 files upgraded. | Fixed (versioning) |
| Signed out, someone else signs in | Items stay on the phone, never sent or shown for the other person; they resume when the owner signs back in. Not cleared on sign-out (Jack's decision). | Already true |
| 401 | `apiFetch` signs out locally; the item waits (not counted as needing the person). | Already true |
| 403 | Needs you: "You don't have permission …". | Already true |
| 409 | Expense id taken by a *different* team's expense: needs you ("Remove this one and add the expense again"). A repeat of the *same* expense is answered 200 `replayed`. | Already true |
| 400 / 422 / other 4xx | Needs you with a plain message. | Already true |
| 408 / 429 | Was treated as permanent (4xx). Now retried, waiting at least the `Retry-After`. | **Fixed** |
| 5xx / timeout / offline | Retried with jittered backoff; needs you after 8 tries. | Jitter, `Retry-After`, flapping guard **fixed** |
| Corrupted / unreadable `queue.json` | Was read as an empty queue and overwritten on the next save (data loss). Now copied to `quarantine-<time>.json`, readable items kept, and a "Some saved items couldn't be read" notice shown. | **Fixed** |
| Photo file deleted | Needs you: "This photo is no longer on the phone. Remove it and take the photo again." (Skipped if the file already reached the bucket.) | Already true |
| Duplicate taps | Same expense id replaces itself; the same photo file queued twice is one receipt; Retry/Remove refused mid-send. | **Fixed** (dedupe + mid-send guard) |

**Idempotency (server, read-only audit):**

- `POST /api/finance/outreach/expenses` (`src/app/api/finance/outreach/expenses/route.ts`): accepts a client `id` (UUID). On a unique violation for the same id **and same team** it returns the existing row with `replayed: true`; a different team gets 409. Safe to repeat.
- Receipt upload: the app uploads to `outreach-receipts` at the path fixed at queue time with `upsert: true`. Safe to repeat.
- `POST /api/finance/outreach/receipts` (`src/app/api/finance/outreach/receipts/route.ts`): looks the file up by `(expense_id, file_path)` first (`getReceiptByPath`) and returns it with `replayed: true`. Safe to repeat.
- Double-send risk: **none known**.

## Vehicle-check outbox (photos + form)

| Situation | What happens | Status |
|---|---|---|
| Queued | Each photo and form gets a UUID at queue time (`InspectionScreen`). | Already true |
| App killed mid-send | Back to waiting, flagged maybe-sent; a photo is then **looked for on the booking before it is sent again** (below). | **Fixed** |
| Restart | Read back; v1 upgraded. | Fixed (versioning) |
| Someone else signs in | Items only send and show for their owner. | Already true |
| 401 | Was "needs you" (permanent). Now waits for the owner to sign back in. | **Fixed** |
| 403 / 400 / 404 / other 4xx | Needs you, with the server's own words where it gave them. | Already true |
| 409 on the form ("already recorded") | Counts as sent (the first try got through). | Already true (see gap 3) |
| 408 / 429 / 5xx / timeout / offline | Retried with jittered backoff and `Retry-After`; needs you after 8 tries. | Jitter, `Retry-After` **fixed** |
| Corrupted store | Quarantined + notice, as for finance. | **Fixed** |
| Photo file deleted | Needs you with "take the photo again". | Already true |
| Duplicate taps | The same photo file, or the same form for the same check with the same answers, is queued once. | **Fixed** |

**Idempotency:**

- `POST /api/vehicles/inspections` (`src/app/api/vehicles/inspections/route.ts`): refuses a second inspection of the same kind for a booking with 409 "already recorded", and only the first insert emails the vehicle managers. Effectively safe to repeat.
- `POST /api/vehicles/inspections/upload` (`src/app/api/vehicles/inspections/upload/route.ts`): **not idempotent.** The server makes up the path (`${bookingId}/${kind}/${Date.now()}-${random}.${ext}`, `upsert: false`), so a retry after a lost answer would store a second copy. Client-side mitigation (no server change): the uploaded file name now carries the item id (`IMG_1__<id>.jpg`; the route stores `file.name` as `file_name`). Any try that may have arrived (timeout, dropped connection, 5xx, app killed mid-send) sets `maybeSent`, and before the next try the app reads `GET /api/vehicles/inspections/files?booking_id=…` and treats a file with that id as sent. If that list can't be read because of a refusal, the photo is sent again (a possible duplicate photo beats a lost one); if there's no signal, it waits.
- Double-send risk: **low** (only if the files list is refused while the first copy did arrive). Server follow-up below removes it.

## Door check-in queue

| Situation | What happens | Status |
|---|---|---|
| Queued | Only while offline (or on a dropped connection): saved as "not yet confirmed". Ids were `Date.now()`+counter; now a UUID (`expo-crypto`). One entry per event + code (a second scan of the same code is ignored). | Id **fixed**; dedupe already true |
| App killed mid-send | Back to pending on load; resent (the server check-in is idempotent). | Already true |
| Restart | Read back per user; v1 upgraded. | Fixed (versioning) |
| Someone else signs in | Stored per user id, and now also re-checked before each send (`stillOwner`), so a session change mid-flush stops it. | **Fixed** |
| 401 | Stops the flush; the scan isn't counted as a failed try. | **Fixed** |
| 403 / 400 / other 4xx | Was put back to "pending" forever with no explanation. Now **Needs you** with the reason, Retry and Remove (Remove asks first). | **Fixed** |
| Server says void / wrong event / invalid | "Turned down" banner (the server answered; nothing is lost). | Already true |
| 5xx / 429 / bad response | Was left pending until connectivity or the count changed (could sit forever while online). Now retried on a jittered backoff timer; needs you after 8 tries. | **Fixed** |
| Timeout / offline | Stops the flush; resent on reconnect, on return to the foreground (new), on the backoff timer (new) or "Send now". | **Fixed** (foreground + timer) |
| Corrupted / unreadable entry | Was read as an empty queue and then overwritten (data loss). Now copied to `…:quarantine:<time>`, readable scans kept, notice shown on the door. | **Fixed** |
| Duplicate taps | Camera debounce + the same code once per event; "Send now" while syncing is ignored. | Already true |

**Idempotency:** `POST /api/events/[id]/check-in` → `checkInTicket` (`src/services/ticket-check-in.ts`) answers `already_checked_in` for a ticket that is already in, and the update is guarded by `status = 'valid'`. A repeat is safe and reads as confirmed. Double-send risk: **none** (a repeat can't check anyone in twice).

## Known gaps and follow-ups

1. **Vehicle-check outbox only runs while Bookings is open.** Its provider is mounted in `app/(app)/bookings/_layout.tsx`. Moving `<BookingsOutboxProvider>` next to the finance `OutboxProvider` in `app/(app)/_layout.tsx` is a one-line change this slice may not make.
2. **Door scans for an event only send while that event's door is open.** The queue is per event and per door client. A banner elsewhere ("3 scans from Send Night not yet sent") would need a small Tickets home change.
3. **Form 409 "already recorded" is taken as sent**, even if the existing record came from someone else (e.g. the web). The person's answers are then not on FFSA Hub. Needs the server to return the existing inspection (or a client id) so the app can tell "mine" from "someone else's".
4. **If AsyncStorage itself throws on read** (not a damaged value, an I/O error), the door can't copy the value aside; the next save would replace it. Very rare; noted.
5. **"Sent" is not a row of its own.** The item leaves the list and the server's record takes its place; keeping sent rows would clash with the screens' "is this check's form still on the phone?" logic.

### Follow-ups that need server work (not done here)

- `POST /api/vehicles/inspections/upload`: accept a client id (or derive the path from it, `upsert: true`) so a repeat replaces instead of duplicating. Then the app's look-before-resend check can go.
- `POST /api/vehicles/inspections`: on 409, return the existing inspection's id/creator so the app can tell a replay of its own form from someone else's.
- `src/lib/api.ts` `ApiError`: carry `Retry-After` (and maybe the server's `error` text) so outboxes don't need their own `fetch` wrapper. None of the routes the outboxes call send `Retry-After` today; the wrapper is ready for when they do (e.g. if rate limits are added).
