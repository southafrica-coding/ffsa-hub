# The 7am reminder as it runs today

Today the daily reminder is a **Claude scheduled task** on Gideon's account ("FFSA vehicle inspection reminders"). It runs every day at **06:58 Africa/Johannesburg** (`CRON_TZ=Africa/Johannesburg 58 6 * * *`), reads the Fleet app's database, and sends the message by Gmail and as a Slack DM.

`server/reminder.js` is the same rules as plain code (with tests in `test/api.test.js`). In the Hub, run it from the Hub's scheduler and send it to whoever holds the **Vehicle Co-ordinator** role, through the Hub's own Slack app and email. When that works, Gideon switches the scheduled task off.

Below is the scheduled task's prompt, word for word (17 Nov 2026). It is the spec `reminder.js` follows.

---

Send today's FFSA vehicle inspection reminder. This runs every morning just before 7am South African time (Africa/Johannesburg). Work out today's date in that time zone.

DATA SOURCE
The FFSA Fleet app is a Claude artifact: <the Fleet app artifact (slug and link kept out of the repo)>. Read its database with the claude-artifacts tools (db_get for single documents, db_list for collections). Only read; never write to the database.
- config/schedule: days = inspection weekdays as numbers (Mon=1 … Sun=7); maxPerDay; assign = {vehicleId: weekday number}; weeklyOnly (may be missing) = list of Mondays (YYYY-MM-DD) of weeks that have weekly checks only.
- config/notify: email (who gets the reminder) and slack (true/false).
- config/checklist (may not exist): sections[].items[], each item with an "in" array of check types. If this document exists and any item's "in" contains "monthly", monthly checks are in use; otherwise every routine check is a weekly check.
- collection "fleet": one document per vehicle (the document id is the vehicleId), with name, reg, status, statusSince (YYYY-MM-DD), lastCheck {date, type} (date of the latest routine check, weekly or monthly), lastMonthly {date} (latest monthly check), lastPost {date} (latest post-trip check), followUp {date, until, kind, provider} (next workshop visit; until is the day it's back, may be empty), cardPrinted {date, stale} (when the laminated in-car guide was last printed; stale true means the vehicle's details changed since), odometer (latest km reading), lastService {date, km} (latest service), lastB2B {date, km} (latest bumper-to-bumper inspection at the workshop), serviceKm (optional: service interval in km for this vehicle).
- collection "trips": trips and rentals, each {vehicleId, from, to, label} with dates as YYYY-MM-DD. A vehicle is away on every date from "from" to "to", inclusive; "to" is the day it comes back.
- collection "records": workshop visits. Those with status "booked" are upcoming workshop visits: {vehicleId, date, until, kind, provider}. A booked visit covers every date from "date" to "until" inclusive (just "date" if until is empty).
Vehicle statuses: In service, On a trip, Booked for workshop, In workshop, Off the road, For sale.

RULES
A week runs Monday to Sunday. A vehicle's planned check date in a given week is the day of that week matching assign[vehicleId].
A vehicle's routine check counts as DONE for a week if lastCheck.date falls in that week (Monday–Sunday).
Which check: the check due is the MONTHLY check if monthly checks are in use, the Monday of the planned date's week is not in config/schedule.weeklyOnly, and the vehicle has no lastMonthly.date on or after the 1st of the month of the planned date. Otherwise it's the WEEKLY check.
Ignore vehicles with status "For sale" or "Off the road", and vehicles with no assigned day.
For each of these three days: TODAY, TOMORROW (24-hour reminder) and the DAY AFTER TOMORROW (48-hour reminder), list the vehicles planned for that day whose check is not yet done for that day's week.
- If that day falls inside one of the vehicle's trips, don't list it as due; put it under "Postponed" as "away until <to> (<label>), check when it's back".
- If the vehicle's status is currently "On a trip" or "In workshop", also put it under "Postponed" (on a trip / at the workshop) instead.
Also list under "Still to do this week" any vehicle whose planned day this week is already past, whose check isn't done this week, and which is now available (today is not inside one of its trips, and its status is not On a trip / In workshop). If it came back after the planned day (statusSince on or after the planned day, or a trip that covered the planned day has ended), say "back since <date>, check now"; otherwise say "overdue since <planned date>".
"Clashes": the workshop visits are the booked records plus each vehicle's followUp (from followUp.date to followUp.until, or just followUp.date), without counting the same visit twice (followUp.recId is the record's id). For any workshop visit that ends today or later and shares at least one day with one of that vehicle's trips that ends today or later, say "<vehicle>: <kind> (<dates>) clashes with <label> (<from> – <to>), sort it out on the Calendar page". For any two trips of the same vehicle that share a day and end today or later, say "<vehicle>: double booked, <label> (<dates>) and <label> (<dates>)".
"Trips": for any trip whose "from" is today or tomorrow, say "<vehicle> leaves <day> (<label>, back <to>): do a pre-trip check". For any trip whose "to" is yesterday or today, and the vehicle has no post-trip check (lastPost.date) on or after that "to" date, say "<vehicle> is back from <label> (<to>): do a post-trip check".
"Workshop visits": any vehicle whose followUp.date is today or tomorrow (kind and provider).
"Services and inspections" (by km): FFSA rule: a bumper-to-bumper inspection at the workshop every 5000 km and a service every 10000 km (use the vehicle's serviceKm instead if it is set and above 0). A service visit covers the inspection too. For each vehicle not "For sale" or "Off the road" that has an odometer reading:
- next service km = lastService.km + 10000 (only if lastService.km is set).
- next inspection km = the higher of lastService.km and lastB2B.km (whichever are set), plus 5000. Skip the vehicle if neither is set.
- km left = that km minus odometer.
- If there is a next service and either (a) next service km is no more than 500 above next inspection km, or (b) both have 500 km or less left, treat them as one visit called "Service and bumper-to-bumper inspection" (use the service's km). Otherwise treat the service and the inspection separately.
- List each visit with 500 km or less left: "<vehicle>: <visit> due in <km left> km (at <km> km), book it at the workshop", or if km left is below 0: "<vehicle>: <visit> overdue by <km> km (was due at <km> km)".
- Leave a visit out if it's already booked: a booked workshop visit (record or followUp) for that vehicle that ends today or later, with kind "Service" (for a service, or the combined visit) or "Workshop inspection (bumper to bumper)" or "Service" (for an inspection on its own). If the combined visit is booked only as "Workshop inspection (bumper to bumper)", list it as "<vehicle>: service and bumper-to-bumper inspection due, booked <date> as an inspection only: ask for a service too".
"In-car guides" (ONLY on Mondays; leave this section out on other days): for each vehicle not "For sale" or "Off the road": if cardPrinted is missing, say "<vehicle>: print and laminate the in-car guide (Manual tab)"; if cardPrinted.stale is true, say "<vehicle>: in-car guide out of date, print a new one"; if cardPrinted.date is 182 or more days before today, say "<vehicle>: in-car guide is 6 months old, print a new one".

MESSAGE
If every section is empty, send nothing and finish.
Otherwise write one short, plain message:
Subject: "FFSA inspections – <weekday, d Mon>: <n> due today" (adjust wording when nothing is due today, e.g. "2 due tomorrow").
Sections in this order, leaving out empty ones: Today, Tomorrow, In 2 days, Still to do this week, Clashes, Trips, Postponed, Workshop visits, Services and inspections, In-car guides. Each vehicle on its own line: name (registration), followed by " – monthly check" or " – weekly check" in the sections that list due checks. End with: "Open the inspection app: <the Fleet app link>".

SENDING – do these in order, each exactly once
1) EMAIL: call the Gmail send_message tool once, with to = [the address in config/notify.email, or <the co-ordinator's email> if empty], subject as above, and the message as the plain-text body (no Markdown). Note whether it succeeded, and if it failed, the exact error text.
2) SLACK: if config/notify.slack is true, send ONE Slack direct message with the same text to the person with that email: search Slack users by the email; if there's no match and the email is <the co-ordinator's email>, send it to Gideon Botha, their Slack account. If step 1 failed, add a last line to the Slack message: "Email reminder failed: <the error text>". Never send the Slack message more than once, even if a call seems slow.
If no Slack user can be found, say so in the email instead (if the email worked).

If the database can't be read, send one short note by email (and Slack, as above) saying today's inspection reminder couldn't be prepared and what went wrong. Don't guess the schedule.
