# Prayer Room (Phase 2, slice 2)

The Prayer tab: the week ("the wall"), set details as a bottom sheet, practice bookings and "My sets". It mirrors the website's `/prayer-room` (`src/app/(admin)/prayer-room/**` at the repo root) and calls the website's **existing** `/api/prayer-room/*` routes with the bearer token. No new backend routes, no migrations.

| File | What |
|---|---|
| `api.ts` | API contract (zod, tolerant). Every route used is listed at the top. |
| `server-message.ts` / `api-client.ts` | The shared `createApiFetch`, plus it keeps the server's `{"error": "..."}` sentence (the database's clash messages) on failures. |
| `logic.ts` | Week maths (SAST = UTC+2, Sunday-start weeks), the wall's rules (lead seats, curated bands), seat counts, spoken sentences, the permission gate, friendly errors. |
| `day-strip.ts` | The week as the phone shows it: Monday to Friday, one day at a time. Which week "This week" is (the coming one at a weekend), the day a week opens on, the Mon–Fri label, and each day's one marker word (Blocked › No lead › Invited › You). Display only: the API range and the saved-week cache stay keyed on the Sunday that starts the week. |
| `practice-logic.ts` | Ported from the web's `src/lib/prayer-room/practice.ts`. Describes the DB's rules so the UI can say why; the DB still decides. |
| `cache.ts` | Last six weeks saved per user, for "Offline, showing saved week". |
| `hooks.ts` | Loaders (loading / error / ready), and `useAction` (confirm, run, haptic; no optimistic updates). |
| `components/`, `screens/` | The screens, built from the shared kit (`src/components`). `components/ui.tsx` holds the few pieces the kit doesn't carry: the week stepper, the band chip, the day header. Strings live in `strings.ts`. |

What the phone does, and what stays on the website:

- **Everyone:** see the week, open a set, ask the lead for an open seat, accept or decline an invitation, see practice and book a station for themselves (30 or 60 min), cancel their own practice booking.
- **Owners and staff:** filling seats, removing people, editing, repeating or cancelling a set open the website (one row in the sheet).
- **Evaluators and staff** (web gate: `prayer_room.evaluate`, or staff): one "Open evaluator tools on the web" row in My sets.
- **Website only for now:** creating sets, booking a full band or a vocal group with other singers, admin moves, the join/evaluation form, adding a set to the phone's calendar.

The server and RLS decide everything. The gates here are for the interface only.

## Layout (iPhone redesign, mockup frames 4.1–4.9)

- **Week:** the large title, the Week · Practice · My sets strip, the week stepper ("16–20 Nov · This week"), the one yellow band (sets nobody leads), then the Mon–Fri day strip and the chosen day's run of sets. The prayer room isn't bookable at weekends, so weekend days are never shown.
- **Set sheet:** one row per seat, the two lead seats first, in the shared `Sheet`.
- **Practice:** your bookings, then each weekday's 30-minute rows with a square per station; the booking sheet's stations are a two-column grid.
- **My sets:** Invitations (the band), Sets you're serving in, Sets you set up, More on the website.
