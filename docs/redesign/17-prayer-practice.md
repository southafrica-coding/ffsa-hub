# 17 · Prayer room — Practice

Design: turn 36 in `FFSA Hub Redesign.dc.html` (36a–36e).

**Before writing anything:** read the current prayer room schema and routes on main. The
prayer room has been reworked since migration 084, so extend what's there — don't
assume the table names below already exist or don't exist. Ask before you rename or
drop anything.

---

## The rules

1. **Window.** 16:00–17:30 on Mon, Wed, Thu, Fri. That's three 30-minute rows a day.
2. **Tuesday is closed** for ministry night. The wall shows a hatched block reading
   "MINISTRY NIGHT, NO PRACTICE" rather than leaving it empty, because empty on the wall
   means free.
3. **NIGHT moves to 17:30–20:00**, which is 150 minutes.
4. **Practice doesn't count toward coverage** of the 120 hours.
5. **Seven stations, one person each:** Drums, Keys, Electric, Cajon, Acoustic, Bass,
   Vocals. Everyone in a row practises at once, each on their own ME mix.
6. **Vocals is one booking.** It's either solo, or a group of up to 4 named singers.
   Singers can't each book a vocal slot of their own.
7. **Full band** takes the whole room. The lead names the band and picks who's on each
   instrument, and each person is told. While a band holds a row, no station in it can
   be booked by anyone else.
8. **A band can only book an empty row.** If a row has any bookings, the band option is
   greyed out and says why: "2 people already practising."
9. **Only an admin can move people** to make room for a band. They have to give a reason.
   Each person who's moved gets a message that's written for them: what they lost, what
   they keep, the reason, and the admin's name. Every move is recorded.
10. **Bookings open every Sunday** for the Monday–Friday that follows, and only that week.
    Default is 00:00 SAST on Sunday.
11. **Maximum length is 60 minutes**, meaning the same station in two rows next to each
    other. No weekly caps, no cancellation cut-off, no flags for not turning up.
12. **Anyone in the prayer room can book.**
13. **Names are on the wall** for everyone.

---

## Suggested shape (adapt to what exists)

- `practice_settings` (one row): start time, end time, slot length (30), closed weekdays
  (`[2]`, which is Tuesday), max minutes (60), when booking opens (Sunday 00:00).
- `practice_stations`: slug, label, sort order, `max_people` (1 for every station except
  vocals, which is 4). This is a table rather than an enum so adding a station later
  doesn't need a migration.
- `practice_bookings`:
  - `kind`: `'station' | 'band'`
  - `date`, `start_time`, `end_time`
  - `station_id`: null when `kind` is `'band'`
  - `booked_by`
  - `band_name`: only for bands
  - `status`: `active` / `cancelled` / `moved`
- `practice_booking_people`: who is in a vocal group, or who is on which instrument in a
  band (`booking_id`, `user_id`, `station_id`).
- `practice_moves`: an audit of what an admin moved (`booking_id`, `moved_by`, `reason`,
  `message`, `created_at`).

## Constraints to enforce in the database or the route, not only in the UI

- No two active `station` bookings for the same station overlap on the same date.
- No `station` booking overlaps an active `band` booking, and the reverse.
- Bookings are only allowed on open weekdays, inside the window, and in 30-minute steps.
- Length is 60 minutes at most.
- Bookings can't be made before that week's Sunday opening.
- Only admins can call the move endpoint. It refuses unless there's a reason.

---

## Screens

- **36a: practice on the wall.** A bone lane named PRACTICE sits in the gutter between
  the ordinary sets and NIGHT:
  - each row shows its time, seven squares (DR KY EL CJ AC BS VX, black when taken), how
    many stations are open, and the names
  - a full band is one block with a heavy border across its rows
  - your own booking has a bolder border
- **36b: the booking drawer.** Your instrument is picked from your profile, taken stations
  show who has them, and you can choose 30 or 60 minutes. Choosing Vocals adds "Just me"
  or "A group" with a picker for up to 4 singers. Under the stations there's a full-band
  option, greyed out with the reason when the row has bookings.
- **36c: booking a full band.** Fields: band name, which rows (up to 60 minutes, empty
  rows only), and who's on each station. Rows that already have bookings are greyed
  with the names and "Only an admin can move them."
- **36d: an admin making room.** Shows who loses which half-hour and what they keep, a
  required reason, a preview of the message, and two choices: move them, or pick
  another row.
- **36e: on a phone.** Day tabs (Tuesday struck through), three rows each with seven
  station buttons and a full-band button, all at least 48px tall, and a note saying
  when next week opens.

## Also update

Anywhere NIGHT is defined as 17:00–19:00, whether that's a seed, a constant or the
curated-band settings, should now be 17:30–20:00. Check that coverage maths still
leaves practice out.
