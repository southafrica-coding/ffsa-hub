# FFSA Hub · Vehicles module · Build spec

Version 1.1 · 17 Nov 2026 · Owner: Gideon Botha

## 1. Goal

Rebuild the **FFSA Fleet** app inside the **FFSA Hub** as a Vehicles module, so the vehicle co-ordinator works in one place with their own Hub login. The Fleet app is a Claude artifact that stays private to Gideon. It is the working prototype: every screen, rule and piece of text in this spec is already running there, and in this repo (`app/ffsa-fleet.html`, run with `npm start`).

**It must work the same way.** Copy the flow, the rules and the content. Don't redesign them.

**Non-negotiables**

1. **As easy as the Fleet app.** Phone-first, one tap per checklist point, plain-language help on every point, nothing typed twice.
2. **Time budget.** The co-ordinator's inspections and booking management take at most 4–5 hours a week. Workshop visits themselves are not the co-ordinator's job. Anything a computer can do (scheduling, reminders, clash checks, renter notices, suggestions) happens automatically.
3. **The Guide ships with the module** (tutorial, handover checklist, how it works, problems, what's new) and **is updated with every change** to the module. Put this rule in the repo's contributor notes (or `CLAUDE.md`) so every future change, by anyone, updates the Guide.

## 2. What's in this repo

| Path | What it is |
|---|---|
| `docs/SPEC.md` | This file: roles, data, screens, rules, Hub integration, acceptance tests, build order |
| `app/ffsa-fleet.html` | The Fleet app exactly as it runs on claude.ai. Function names are given in this spec (e.g. `weekly()`) so you can read the exact logic |
| `public/claude-shim.js`, `server/` | The small server and browser shim that run the app outside claude.ai (see `README.md` and `CLAUDE.md`) |
| `server/reminder.js` | The 7am reminder (6.11) as code; `docs/REMINDER_PROMPT.md` is the scheduled task it replaces |
| `seed/db/*.json` | Live data exported on 17 Nov 2026, one file per collection: `fleet` (6 vehicles), `records` (10 workshop visits), `trips` (2 rentals), `providers` (3 workshops), `config` (checklist, schedule, reminder settings). `inspections`, `odometer` and `timelog` are still empty |
| `seed/files/` | The 19 photos and PDFs those records point to (`seed/files/index.json` says which is which) |
| `docs/content/checklist.json` | FFSA's 124-point checklist with every point's help text (why it matters, safety first, how to check, what it looks like, what goes wrong, how to mark it), the walk-around route order and the six walk-around photos |
| `docs/content/vehicle-profiles.json` | Per-model "where things are", known weak spots and point notes (H-1, T5 Kombi, CR-V, Almera) |
| `docs/content/in-car-guide.json` | Text of the laminated in-car guide drivers use |
| `docs/content/rules.json` | Numbers used by the rules (km intervals, warning distance, time estimates, statuses, visit kinds) |
| `docs/content/guide-hub.json` | **The Guide and tutorial for the Hub version**, ready to render (same block format as the Fleet app) |
| `docs/content/guide-fleet-app.json` | The Fleet app's own Guide, for comparison |

## 3. Roles and access

| Who | Access |
|---|---|
| **Vehicle Co-ordinator** (Hub role) | Everything in the module. Receives the daily reminder. Their name and phone number are printed on the in-car guides. |
| **Admin** (Gideon) | Everything, plus module settings (inspection days, time budget, checklist editing). |
| **Person who booked a vehicle** (renter, driver, school) | No module access. Gets booking notices (section 7.3). Optional later: do the 2-minute pre-trip check from a link in their booking. |
| **Leadership / viewers** (optional) | Read-only Vehicles list and vehicle pages. |

When the role moves to a new person, everything follows automatically: reminders, in-car guide details (which then show as out of date), Slack messages.

## 4. Data model

Map these onto the Hub's own tables. Field names are the Fleet app's (as in `seed/db/*.json`: `fleet` = vehicles, `records` = workshop visits, `trips` = bookings, `providers` = workshops, `config` = settings).

**Vehicle** (extend the Hub's vehicle record; don't keep a second list)
`name, reg, make, model, year, colour, fuel, transmission, seats, vin, engineNo, insurer, policyNo, tracker, base, notes, photo, status, statusSince, licenceExpiry, odometer, odometerDate, odoPrev {km, date}, lastService {date, km, provider}, lastB2B {date, km, provider}, serviceKm (optional override), serviceMonths (optional), inspectionDay (1–7), tyres, where (free text, "Label: text" per line), watch [ {t, k: damage|repair|issue, i: checklist item id, d: since} ], condition { itemId: {s, d, v, n, p[], i, t} }, lastInspection {id, date, type, counts}, lastCheck {id, date, type}, lastMonthly {id, date}, lastPost {id, date}, cardPrinted {date, sig, stale}, sort`

Statuses: `In service, On a trip, Booked for workshop, In workshop, Off the road, For sale`. Vehicles that are For sale or Off the road are left out of checks, reminders and suggestions.

**Inspection** `vehicleId, type (pre|post|weekly|monthly|workshop), date, odometer (required), fuel, inspector, provider (workshop type), bookingId/trip (post type), docs[] (workshop report files), results { itemId: {s: ok|mon|fix|na, v (measurement), n (note), p[] (photos), t (point text at the time), sec} }, walk {front, rear, left, right, interior, dash: fileId}, extra[], summary, counts {ok, mon, fix, na}, mins, startedAt, createdAt, createdBy`

**Workshop visit** `vehicleId, status (booked|done), kind, date, until (booked: day it's back; same day if empty), provider, odometer, cost, ref, description, work [ {d, cost, chk: ok|bad|na} ], warrantyUntil, checkedBy, files[], nextDate, nextKm`. In the Hub a **booked** visit is also a vehicle booking of type "workshop" that blocks the vehicle from `date` to `until`.

**Booking** (the Hub's existing vehicle bookings) replace the Fleet app's `trips {vehicleId, from, to, label, note}`. A vehicle is away on every date from `from` to `to` inclusive; `to` is the day it's back.

**Odometer reading** `vehicleId, km, date, note, source (inspection|post-trip|workshop|km-log|handover)`

**Time log** `date, week (Monday), kind (inspection|km|trip|workshop|admin), type (inspection type), vehicleId, mins, by`

**Workshop** `name, services, phone, phone2, email, website, address, hours, notes`

**Settings** `days [weekday numbers], maxPerDay, budgetHours (default 5), weeklyOnly [Mondays], checklist {sections[ {id, name, items[ {id, t, h, in[], m} ]} ]}`. The co-ordinator's name, phone, email and Slack come from the role holder's Hub profile.

## 5. Screens

Every screen works on a 390 px wide phone without sideways scrolling. Run the app (`npm run seed`, `npm start`) to see each one.

1. **Today** (`todayView`, `todayTasks`): the landing page. "To do today" in this order: pre-trip checks for vehicles leaving today; post-trip checks for vehicles back in the last 7 days without one; workshop drop-offs today (button **Dropped off**); vehicles at the workshop (button **Collected**); overdue routine checks; routine checks due today or due because the vehicle is back; services/inspections to book (button **Book**, with the first free 48 hours); booking clashes. Each row shows the vehicle, what to do, roughly how long, and one button. Header: number of tasks and total estimated time. Below: **Coming up** (next 2 days) and **Time this week**. Buttons: **Log a km reading**, **Add trip or rental** (in the Hub: open a booking).
2. **Vehicles** (`fleetView`): **Needs attention** (all non-info alerts, worst first, first 8 then "Show all") and a card per vehicle (photo, reg, odometer, condition bar, status, this week's check, last inspection, top alert).
3. **Vehicle page** (`vehicleView`): header with photo, status (changeable), odometer, check day, last inspection; buttons **Start inspection, Continue draft, Log km, Book workshop, Log workshop visit, Issue list for workshop, Edit details**. Tabs:
   - **Overview**: To do (all alerts), booked workshop visits with **Record the outcome**, Key dates (licence disc, last/next service, service interval, last/next bumper-to-bumper, odometer date, workshop spend over 12 months), **Keep an eye on**, bookings, vehicle details, notes.
   - **Condition**: latest result for every point, filter All / Issues / Not checked yet / OK.
   - **History**: inspections, workshop visits and km readings, newest first.
   - **Photos**: walk-around and issue photos by inspection, workshop photos.
   - **Manual**: in-car guide (PDF) with printed-status line, full manual (PDF), "Where things are", Keep an eye on, every check in walk-around order with help.
4. **Inspection** (`inspectFormView`, `guidedHTML`): choose type; date, odometer (required), fuel, inspected by; **Step by step** (default) or **Full list**. Step by step follows the route in `docs/content/checklist.json`: Get ready → (Keep an eye on) → each stage, with the six walk-around photos at the start of "Walk around the outside" → Finish (unchecked points, flagged points, summary, extra photos). Tapping OK or N/A moves on by itself; Monitor or Fix now opens a note and photo. Points the model doesn't have are pre-marked N/A (`vehicle-profiles.json → na`). Measurements (tread, brake pads) are graded automatically. The draft is saved continuously and survives closing the app.
5. **Inspection detail**: odometer, fuel, inspector, points checked, time taken, walk-around photos, issues, all results, **Copy report text**, Delete (recalculates the vehicle's condition).
6. **Calendar** (`calendarView`): 4-week timeline, one row per vehicle, a column per day (weekends shaded, today highlighted). Bookings blue, workshop visits orange, clashes red, inspection days as a ring (filled when done, red when overdue). Week back/forward. Below: **Clashes and heads-ups** (with **Move … to …** and **Move the workshop visit to …** buttons), **Book a workshop visit** (vehicles due by km with the first free 48 hours and **Book**, a "find a free 48 hours for…" picker), and a list view of the same 4 weeks.
7. **Schedule** (`scheduleView`): this week and next week as day columns with a card per vehicle and a **Start** button; **Services and inspections by km** (per vehicle: next inspection and service, km to go, odometer and its age, projected date, **Log km**); workshop bookings; trips and rentals; inspection days, most per day, time budget; co-ordinator and reminder settings.
8. **Workshops**: list with phone (tap to call), email, address, website, hours, notes; add/edit.
9. **Checklist**: counts per check type, filter, "Show why and how for every point"; **Sort weekly and monthly** (each point Every week / Once a month, suggestions, "Use all suggestions"); **Edit checklist** (wording, hint, which checks, add/remove points and sections). Past inspections keep the wording they were saved with.
10. **Guide**: section 8.
11. **Ask** (optional, phase 5; `askView`, `chatTools`, `chatInstructions`): a chat where the co-ordinator asks about the fleet in plain language ("What's due this week?", "When is the Honda's next service?") or tells it what to record ("Log 312 700 km for the CR-V", "Book the Kombi in for a service"). The reference app sends Claude a snapshot of the live data and offers page tools: log km, add trip, book workshop, dropped off, record the outcome, set service history, set status, add a note, weekly-only week, find a free 48 hours, free vehicles, vehicle history, checklist help, start an inspection. **Every change asks the user to confirm first.** A round chat button floats at the bottom right of every screen (above any save bar) and opens the chat over the current page, so it's one tap away even mid-inspection; on phones people speak through the keyboard's microphone. In the Hub, use the Hub's own AI integration with the same tools and the same confirm step.

Modals: Log a km reading, Book / log a workshop visit (with the booking hint), Add/edit trip (in the Hub: booking), Keep an eye on note, Edit vehicle details, Workshop provider.

## 6. Rules

Use these exactly. Numbers live in `docs/content/rules.json`. `server/reminder.js` implements 6.1, 6.2, 6.4, 6.6 (clashes), 6.9 (reprint) and 6.11 as plain code with tests; reuse it.

### 6.1 Inspection schedule (`weekly()`)

- A week runs Monday to Sunday. Each vehicle has one inspection weekday; inspection days default to Tue, Wed, Thu with at most 2 vehicles a day (saving the schedule refuses a day with too many).
- **Which check:** monthly if there are monthly points, the week isn't marked weekly-only, and the vehicle has no monthly check on or after the 1st of the month of the planned date; otherwise weekly. A monthly check covers every point tagged weekly **or** monthly.
- **Weekly-only weeks:** on the Schedule page each week has a switch "Weekly checks only this week"; the monthly check then moves to the next week. Today shows a note when it's on. Stored as a list of Mondays (`weeklyOnly`).
- **Done** if `lastCheck.date` falls in that week.
- Skip vehicles For sale or Off the road, and vehicles with no inspection day.
- Planned date in the future: "planned", or "away until <date> (<booking>)" if the vehicle is booked out that day.
- Planned date today or past, check not done:
  - vehicle is booked out today → **postponed** ("away until …, check when it's back");
  - status On a trip or In workshop → **postponed**;
  - planned date is today → **due today**;
  - vehicle came back after the planned date (statusSince on/after the planned date, or a booking covering the planned date has ended) → **due now, back since <date>**;
  - otherwise → **overdue since <planned date>**.

### 6.2 Trip checks

- Booking starts today or tomorrow → "Leaves today/tomorrow (<booking>, back <date>): do a pre-trip check".
- Booking ended in the last 7 days and no post-trip check on/after its end date → "Back from <booking> on <date>: do a post-trip check".
- Saving a post-trip check on a vehicle that's On a trip sets it back to In service.

### 6.3 Needs attention (`vehicleAlerts()`)

Per vehicle, each with a severity (crit / warn / info; info shows on the vehicle page only):
licence disc expired (crit) or within 30 days (warn) · km service/inspection alerts (6.4) · date-based service if `serviceMonths` is set (overdue crit, within 30 days warn) · missing service km (info) · workshop follow-up overdue (crit) or within 14 days (warn), or by km within 1 000 km · booking clashes (6.6) · points marked Fix now (crit) / Monitor (warn) · routine check due/overdue (warn) · pre-/post-trip checks (warn) · in-car guide not printed (info), out of date or 6 months old (warn).

### 6.4 Services and bumper-to-bumper inspections by km (`kmPlan()`, `kmAlerts()`)

- Bumper-to-bumper inspection at the workshop every **5 000 km**; service every **10 000 km** (vehicle `serviceKm` overrides). A service visit covers the inspection.
- Next service km = `lastService.km + interval` (only if `lastService.km` is known).
- Next inspection km = `max(lastService.km, lastB2B.km) + 5 000` (whichever are known).
- km left = due km − latest odometer.
- **One visit** ("Service and bumper-to-bumper inspection") when next service km ≤ next inspection km + 500, **or** both have ≤ 500 km left.
- Alert when km left ≤ **500**: warn "… due in X km (at Y km): book it at the workshop"; km left < 0: crit "… overdue by X km (was due at Y km)".
- Already booked (a booked workshop visit for that vehicle ending today or later, kind Service for a service or the combined visit; kind Service or bumper-to-bumper for an inspection alone) → info "… booked for <date>", plus "(ask for a service too)" when a combined visit is booked as an inspection only.
- Recording a done Service (with "use as last service") sets `lastService`; a done bumper-to-bumper inspection sets `lastB2B`. Both **require** the odometer reading.

### 6.5 Odometer and km a day (`odoPatch()`, `kmRate()`, `projText()`)

- Readings come from inspections, workshop visits, Log km, vehicle edits and (Hub) booking handovers. A new reading replaces the current one when it's not lower; a lower one asks for confirmation and is kept in history only.
- When the current reading is at least 7 days older than the new one, it becomes `odoPrev`.
- km a day = (odometer − odoPrev.km) ÷ days between them (needs ≥ 3 days and a positive difference).
- Projected date = odometerDate + km left ÷ km a day. If that's already past: "it may already be past <km>: log a km reading". Readings older than 30 days are flagged "log a new reading".

### 6.6 Clashes and free 48 hours (`clashList()`, `alternatives()`, `suggestGap()`)

- **Clash (crit):** a workshop visit ending today or later shares a day with a booking ending today or later on the same vehicle; or two bookings on one vehicle share a day; or a booking is on a vehicle that's For sale / Off the road.
- **Heads-up (warn):** a booking starts 1–7 days after a workshop visit ends: "make sure it's back and checked in time".
- **Similar vehicle:** same class (seats ≥ 7 = van, otherwise car), in use, no booking or workshop visit in the dates, not In workshop if the booking starts today or earlier.
- **First free 48 hours:** from tomorrow, the first two weekdays in a row (Mon–Fri) with no booking and no workshop visit (ignoring the visit being moved), looking up to 120 days ahead.
- Booking form: as dates change, show clashes, heads-ups and the first free 48 hours with **Use these dates**. Saving a clashing booking asks for confirmation and names free similar vehicles.

### 6.7 Workshop visit flow

Book → status **Booked for workshop** (if it was In service) · **Dropped off** → **In workshop** · **Collected** opens the outcome form (odometer, cost, invoice no., each job on the invoice checked on collection: done properly / not right / couldn't check, warranty, collected and checked by, next follow-up, files) → back **In service**. **Issue list for workshop** builds a text list of every Fix now and Monitor point, plus workshop points not checked in 6 months.

### 6.8 Keep an eye on (`attentionFor()`)

Watch notes, workshop repairs from the last 6 months, and points currently marked Fix now / Monitor. Each is linked to a checklist point (stored, or guessed from the words) and shown at the start of weekly/monthly checks and again on that point.

### 6.9 In-car guide (`cardDoc()`, `cardStatus()`)

A4 PDF per vehicle: name, reg, photo, fuel banner, before you drive (tick boxes), when to stop and call, when you bring it back, where things are, breakdown steps, contacts (co-ordinator name and phone from the role holder, roadside assistance, emergency 112 / 10111). Replace every 182 days. A signature of name, reg, fuel, "where things are" and the co-ordinator's details is stored when printed; if it changes, the guide is **out of date**.

### 6.10 Time tracker (`tickDraft()`, `logTime()`, `timePanel()`)

- Inspections: active time while the form is used; a gap of more than 10 minutes between taps counts as 10 minutes. Saved as `mins` on the inspection and as a time log.
- Bookings, km readings, trips and vehicle edits: time the form was open, 1–15 minutes.
- Today shows minutes this week against `budgetHours`, split into inspections and admin, averages per check type (from 2 or more checks in the last 8 weeks), and an over-budget note. Task estimates use those averages, otherwise pre 3, post 10, weekly 22, monthly 40 minutes.

### 6.11 Daily reminder (07:00 Africa/Johannesburg)

To the Vehicle Co-ordinator by email and Slack (from the Hub's Slack app, shown as "FFSA Fleet"). Sections, empty ones left out, nothing sent if all are empty: Today · Tomorrow · In 2 days (checks due, with weekly/monthly) · Still to do this week · Clashes · Trips (pre/post) · Postponed · Workshop visits (today/tomorrow) · Services and inspections (by km, unbooked) · In-car guides (Mondays only). Subject: "FFSA inspections – <Tue, 17 Nov>: <n> due today". Ends with a link to Today.

## 7. Hub integration (new in the Hub version)

1. **Bookings drive everything.** Hub vehicle bookings replace the Fleet app's trips: they postpone checks, trigger pre-/post-trip checks, show on the Calendar and are checked for clashes.
2. **Km at handover.** Ask for the odometer reading (and fuel) when a vehicle is handed out and handed back. Save it as an odometer reading. This keeps the km warnings accurate without extra work for the co-ordinator.
3. **Workshop visits block the vehicle.** A booked visit blocks the vehicle from `date` to `until` in the booking calendar. When a visit is booked or moved:
   - every booking it overlaps: notify the person who booked; offer similar free vehicles with a one-tap switch; if none is free: "wait until it's back on <date>, or make other plans". Copy the co-ordinator.
   - every booking starting within 7 days after it: send a heads-up about that vehicle.
4. **48-hour suggestion** uses Hub bookings (6.6) and, when km a day is known, prefers a gap before the projected due date.
5. **Role-based delivery.** Reminders, Slack messages and the in-car guide contact all follow the Vehicle Co-ordinator role.

## 8. Guide and tutorial

- Render `docs/content/guide-hub.json`: pages **Start here, Tutorial, Handover, How it works, Problems, What's new**. Blocks: `{h}` heading, `{p}` paragraph, `{ul}` list, `{steps}` tutorial steps `[title, text, link, action, action label]`, `{changes: true}` the What's new list.
- Tokens in `{braces}` are filled from live settings: `{days}` inspection days, `{max}` per day, `{budget}` time budget, `{pre} {post} {weekly} {monthly} {workshop}` point counts, `{inspectKm} {serviceKm} {warnKm}`, `{v}` the first vehicle's id (for "Open it" links).
- Tutorial progress is stored **per user** in the Hub. Each step has an **Open it** link to the screen it's about.
- **Download the guide (PDF)** builds the same content as a PDF for handovers.
- Link to the tutorial from Today ("New here? Start with the tutorial").
- **Keep it updated:** every change to the module updates the relevant Guide text and adds a dated line to What's new. Add this to the repo's contributor notes or `CLAUDE.md`.

## 9. Migration

1. Import `seed/db/providers.json` (workshops), then `seed/db/fleet.json` (match to the Hub's existing vehicle records by registration), then `seed/db/records.json` (booked ones become workshop bookings) and the files in `seed/files/` (`seed/files/index.json` maps each file to its vehicle photo or workshop visit). File ids are referenced as `/_blob/<id>` in the data.
2. `seed/db/trips.json`: the Almera and CR-V rentals (19 Nov – 13 Dec 2026). Check they're already Hub bookings before importing.
3. Settings from `seed/db/config.json` → `schedule`: inspection days Tue/Wed/Thu, max 2 a day, H1 #1 and H1 #2 Tuesday, H1 #3 and Kombi Wednesday, CR-V and Almera Thursday; weekly-only weeks 16 and 23 Nov 2026 (monthly checks for all vans in the week of 30 Nov). `notify`: reminder email and Slack on/off.
4. Checklist from `seed/db/config.json` → `checklist` (the live one), with the help text from `docs/content/checklist.json`.
5. No inspections have been recorded yet, so there's no inspection history to move. Re-export just before go-live in case that changes.
6. Go-live: Gideon switches off the Fleet app's 7am scheduled task and keeps the Fleet app as an archive.

## 10. Acceptance tests

Run with the exported data on **Tue 17 Nov 2026** unless stated.

1. Today lists H1 #1 and H1 #2: "Weekly check · Due today", about 22 minutes each (the week of 16 Nov is weekly-only). Coming up: H1 #3 and Kombi weekly checks tomorrow; CR-V bumper-to-bumper at Motech tomorrow; H1 #3 and Kombi bumper-to-bumper Thu 19 Nov; CR-V and Almera leave Thu 19 Nov (Rental, back Sun 13 Dec).
2. Calendar heads-up: "CR-V · Rental starts Thu 19 Nov, the day after the bumper-to-bumper inspection (Wed 18 Nov)".
3. H1 #2 with last service 215 000 km and odometer 224 920 km: "Service and bumper-to-bumper inspection due in 80 km (at 225 000 km)", one visit.
4. Almera with last service 121 000 km and odometer 131 153 km: "Service and bumper-to-bumper inspection overdue by 153 km (was due at 131 000 km)", crit.
5. CR-V with last bumper-to-bumper 308 000 km, odometer 312 606 km, booked Wed 18 Nov: info "Bumper-to-bumper inspection due at 313 000 km: booked for Wed 18 Nov".
6. A Service visit booked 25–26 Nov on the Almera (on rental): clash; "No similar car is free"; "Move the workshop visit to Mon 14 – Tue 15 Dec".
7. A Kombi booking 19–21 Nov over its 19 Nov workshop visit: clash; free vans H1 #1 and H1 #2; moving it to H1 #1 clears the clash.
8. With the data from test 3, Log km 224 990 on H1 #2: saved, odometer updated, the previous reading kept as `odoPrev`, toast "Service and bumper-to-bumper inspection due in 10 km".
9. Logging a done bumper-to-bumper inspection without an odometer reading is refused with a message.
10. A weekly check with 17 minutes of active use saves `mins: 17` and a time log; Time this week goes up by 17 minutes.
11. Changing the co-ordinator marks every printed in-car guide out of date.
12. Every screen at 390 px wide: no sideways page scroll.
13. On Tue 1 Dec 2026 the routine checks are monthly again (the weekly-only weeks are over).
14. The daily reminder for Tue 17 Nov 2026 matches `test/api.test.js` (`npm test`).

## 11. Build order

Each phase updates the Guide and What's new.

1. **Core:** vehicles (extend Hub records), checklist with help, inspections (step by step + list, photos, drafts), vehicle page with tabs, Needs attention, Guide.
2. **Daily work:** schedule, Today, time tracker, daily reminder to the role (email + Slack), Log km.
3. **Bookings:** workshop visits as bookings, handover km, clashes, similar-vehicle switch, renter notices, 48-hour suggestions, Calendar.
4. **Print:** in-car guide and full manual PDFs, guide PDF.
5. **Ask (optional):** the chat in section 5.11.
