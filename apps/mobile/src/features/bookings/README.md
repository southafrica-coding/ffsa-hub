# Bookings (phone): spaces, vehicles, approvals, vehicle checks

Phase 2, slice 3. Mirrors the website's `/bookings/spaces/**` and
`/bookings/vehicles/**`. A hidden route (no tab): opened from the Home
shortcut, and from Home feed items whose link is a bookings page.

| Route | Screen |
|---|---|
| `app/(app)/bookings/index.tsx` | My bookings: Waiting for approval / Upcoming / Past, New request, approvals entry |
| `app/(app)/bookings/new.tsx` | New request, a step at a time (space or vehicle) |
| `app/(app)/bookings/approvals.tsx` | Waiting for you: pending spaces and vehicles (approvers only) |
| `app/(app)/bookings/space/[id].tsx` | A space booking: details, clash check, approve / decline, cancel |
| `app/(app)/bookings/vehicle/[id]/index.tsx` | A vehicle booking: drivers, approve / decline, cancel, collection and return |
| `app/(app)/bookings/vehicle/[id]/[kind].tsx` | Collection or return check (`kind` = `collection` / `return`) with photos |

## Rules this code keeps

- **Reads** go straight to Supabase as the signed-in person (`data.ts`), the
  same queries the web pages run with the user's client; RLS decides.
- **Writes** only go through the web's API routes (`api.ts`), so the
  server-side steps run: the clash and licence checks, the vehicle managers'
  emails, the requester's Slack DM and email, the prayer-room alerts. Every
  route used builds its client with the web's bearer-aware `createClient()`.
- **Clashes and availability are the server's answers** (`dryRun: true` on
  the create routes), never worked out on the phone. The licence status next
  to a driver is a hint; the API re-checks at submit and at approval.
- **`http.ts`** is this slice's request helper: like `apiFetch` (bearer, 15 s
  timeout, 401/403 handling) but it keeps the server's `{ error }` words on a
  4xx and can send multipart (vehicle photos).
- **Vehicle-check photos and forms are never lost** (`outbox/`): queued on
  disk in the documents folder before anything is sent, retried with the same
  backoff as the finance outbox, and only the person's Remove deletes an
  unsent item. A second copy of a form is answered 409 "already recorded",
  which the queue treats as delivered.
- `useMe()` decides what is shown (`access.ts`); the server decides what is
  allowed, and a 403 shows "not available on your account".
- All strings are in `strings.ts`.

## Why a separate outbox

The finance outbox is built around expenses and receipts (an expense id and
team, a direct bucket upload, then an API registration). Vehicle photos go to
a different route as multipart, and the check form is another call, so this
is a small sibling queue that reuses finance's backoff and give-up rule,
image resize plan and camera-permission rule. It has its own folder so the two
outboxes' tidy-up passes never touch each other's photos.

It is mounted in `app/(app)/bookings/_layout.tsx` (this slice owns only that
folder), so it sends while Bookings is open and picks up where it left off
next time. Moving `<BookingsOutboxProvider>` next to the finance
`<OutboxProvider>` in `app/(app)/_layout.tsx` is a one-line follow-up.

## Not in the app (links to the website)

Weekly / repeating space bookings, drivers who aren't on FFSA Hub (their
licence and passport photos), assigning vehicles, the vehicle policy
agreement and payment, equipment (no request flow exists yet), the calendar
board and all admin pages.
