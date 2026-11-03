# Prayer Room (Phase 2, slice 2)

The Prayer tab: the week ("the wall"), set details as a bottom sheet, practice bookings and "My sets". It mirrors the website's `/prayer-room` (`src/app/(admin)/prayer-room/**` at the repo root) and calls the website's **existing** `/api/prayer-room/*` routes with the bearer token. No new backend routes, no migrations.

| File | What |
|---|---|
| `api.ts` | API contract (zod, tolerant). Every route used is listed at the top. |
| `server-message.ts` / `api-client.ts` | The shared `createApiFetch`, plus it keeps the server's `{"error": "..."}` sentence (the database's clash messages) on failures. |
| `logic.ts` | Week maths (SAST = UTC+2, Sunday-start weeks), the wall's rules (lead seats, curated bands), seat counts, spoken sentences, the permission gate, friendly errors. |
| `practice-logic.ts` | Ported from the web's `src/lib/prayer-room/practice.ts`. Describes the DB's rules so the UI can say why; the DB still decides. |
| `cache.ts` | Last six weeks saved per user, for "Offline, showing saved week". |
| `hooks.ts` | Loaders (loading / error / ready), and `useAction` (confirm, run, haptic; no optimistic updates). |
| `components/`, `screens/` | The screens. Strings live in `strings.ts`. |

What the phone does, and what stays on the website:

- **Everyone:** see the week, open a set, ask the lead for an open seat, accept or decline an invitation, see practice and book a station for themselves (30 or 60 min), cancel their own practice booking.
- **Owners and staff:** filling seats, removing people, editing, repeating or cancelling a set open the website (one row in the sheet).
- **Evaluators and staff** (web gate: `prayer_room.evaluate`, or staff): one "Open evaluator tools on the web" row in My sets.
- **Website only for now:** creating sets, booking a full band or a vocal group with other singers, admin moves, the join/evaluation form, adding a set to the phone's calendar.

The server and RLS decide everything. The gates here are for the interface only.
