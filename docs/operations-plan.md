# Operations — plan

Draft, 23 Nov 2026. Nothing built yet. This is the shape of the thing and the order we'd build it in.

## What it's for

One place where the operations team can see what needs attention across the base, so nothing falls through the cracks and everyone knows what's happening. It is **not** a tool for checking up on people: no per-person scores, no "who closed the most", no red names. Things that are stuck show as *stuck*, not as *someone's fault*.

Three rhythms carry it:

1. **Every morning (07:00)** — a Slack message per area: what came in yesterday, what's on today, what has gone quiet. Buttons right in Slack: *Done · Inspected · Needs more time · Add a note*.
2. **Every week** — a summary built automatically for the operations meeting: what got done, what's new, what's still open, by area.
3. **At the meeting** — tasks are given to a person with a deadline. That person gets their own reminders (and only that person).

## The eight areas

Operations becomes one module in the sidebar with eight tabs. Where the Hub already has the thing, Operations **reads from it** — it doesn't build a second copy.

| Area | What it holds | Builds on |
|---|---|---|
| **Maintenance** | Requests from the Slack form, status, notes, who's on it | New. Intake stays the Slack form |
| **Transportation** | What's happening with vehicles: inspections, findings, damage, bookings | Fleet (inspections) + vehicle bookings — already built |
| **Equipment** | Same idea as vehicles: what's out, what's damaged, what's due back | Equipment hire + gear register — already built |
| **Buildings & spaces** | Repairs and renovation projects; who is using which space when | Space bookings + venues — already built. Projects are new |
| **Hospitality** | Rooms, who's in them, arrival/departure, room inspections, guest speakers | New |
| **Visiting teams** | Every team coming to the base: dates, travel, size, purpose, needs | New (feeds Hospitality + Transportation) |
| **Events** | The operations side of an event: setup, rooms, transport, needs | Existing Events module — adds a logistics view |
| **Innovations** | Ideas and requests, what happened to each and when | New |

## The one shared idea: an "item"

Every area produces **items** — something that needs someone's attention. A maintenance request is an item. Damage found on a vehicle is an item. A room that needs inspecting before a team arrives is an item. A task from the meeting is an item.

Each item has: area · title · where · status · who's on it (optional) · deadline (optional) · where it came from (Slack, Fleet, meeting, Hub) · a running log of updates and notes.

Statuses, in plain words:

- **New** — nobody has looked yet
- **Seen** — inspected / acknowledged
- **In progress**
- **Needs more time** — with a note saying why (and optionally a new date)
- **Done**
- **Won't do** — with a note

Because every area speaks "items", the morning message, weekly summary and meeting all work the same way for all eight areas — we build them once.

## Maintenance (first, because the data is already flowing)

Today: the Slack Workflow posts each request into `#maintenance-request-submissions` (issue · location · name), and someone forwards it to the maintenance team by hand.

Plan:

- The Hub's Slack bot listens in that channel and turns each post into an item (issue, location, who asked, when). No change for the person submitting.
- Morning message to the maintenance team: *new since yesterday*, *still open*, *gone quiet* (no update for N days).
- Anyone on the team can tap *Done / Seen / Needs more time / Add a note* in Slack or on the Hub.
- **The person who asked hears back** when it's marked done or needs more time. (In `#maintenance-requests` people are already asking "any update on my water pressure?" — this answers them without anyone having to.)
- Repeat locations show up: "A6 — 3 requests this month" (hot water, toilet, power) so it can become a Buildings project instead of three patch-ups.

## Transportation and equipment

- Fleet inspections done today → tomorrow's morning message carries a short report per vehicle: what was found, any damage, what's now out of action.
- Damage or a failed check point becomes an item, so it's tracked until fixed.
- The ops team sees vehicle status without opening Fleet: in use, out of action, inspection due.
- Equipment works the same off the gear register and hire bookings.

(Fleet's rules don't change for this — Operations only reads what Fleet records.)

## Hospitality and visiting teams

These two share data, so they're built together.

- **Rooms register** — every room/bed, with type and capacity.
- **Stays** — who is in which room from when to when (school, team member, guest speaker, guest).
- **Visiting team** — name, sending organisation, contact person, number of people, purpose, arrival and departure dates, flights/travel, dietary and other needs, who's hosting them. Creating a team can raise the items that follow from it: rooms to allocate, airport pickup (→ vehicle booking), room inspection the day before arrival.
- **Room inspections** — a short checklist before arrival and after departure; problems found become maintenance items.
- Morning message: arrivals and departures today and this week, rooms still to inspect, teams with unanswered needs.

## Buildings & spaces

- Space bookings already exist — this tab shows the week at a glance: who is using what, when.
- **Projects** for repairs and renovations: what, where, budget (optional), stages, status, log. Bigger than a maintenance request.

## Events

The existing Events module stays the home of an event. Operations adds the logistics view: setup and pack-down items, rooms, transport, equipment, linked to the event.

## Innovations

A simple log: anyone submits an idea or request → it's discussed at the meeting → approved / parked / in progress / done, with the date of each step. The point is the history: what was suggested, when, and what came of it.

## Weekly summary and the meeting

- Sent to the ops channel at close of work the day before the meeting (Tuesday 17:00), so everyone can read it first. Also visible any time at `/operations/week`.
- Per area: **Done this week · New this week · Still open · Needs a decision**.
- During the meeting someone opens the meeting page and walks it. For each thing: assign a person + deadline, or note a decision. That becomes an item with an owner.
- After the meeting: a short recap goes to the ops channel.

## Personal reminders

Only for items with an owner and a deadline (i.e. things actually handed to someone):

- A Slack DM when it's given to you.
- Included in your morning message while it's open.
- A nudge the day before the deadline, and once on the day.
- If it passes the deadline: one gentle message to *you*, and it shows as "past its date" in the weekly summary for the meeting to talk about. No escalation to anyone else.

## Operations is a department

Jack is building **Departments & Services** (`feat/departments-services`, migrations 318–321). There, a *department* is a staff ministry with its own home (`/departments/<slug>`: overview, people, OKRs, rocks, budget), and a *service* is a tool the departments own and others use (spaces, vehicles, gear hire…).

Operations is a **department**: the existing staff ministry `operations` (backbone). In Jack's seed it already owns the **spaces**, **vehicles** and **gear hire** services, which line up with Buildings & spaces, Transportation and Equipment here.

So:

- **The team is the department.** Anyone on the Operations department's roster (Ministries → Operations) can use Operations and can be given tasks. No separate role to hand out. An `operations.team` permission exists only for a helper from outside the department. Admins can open it but aren't in the "given to" list just for being admins.
- **When Departments & Services lands**, the Operations department home gets a link (or tab) into `/operations`, and Operations moves under Departments in the menu instead of being its own top-level entry. Until then it sits in the sidebar on its own.
- What the department *owns as services* (spaces, vehicles, gear hire) stays in those services. The Operations areas only read from them.

## Who sees what

- The Operations department (members and leaders), operations.team helpers, and admins see everything in Operations.
- Someone given a task who isn't in the department sees and updates just that task.
- Anyone at the base can submit a maintenance request (Slack form); they get told when it moves.

## Order we'd build it

Each step is a pull request that works on its own.

1. **Foundation + Maintenance** — Operations module, items + updates, Slack intake from the request channel, morning maintenance message with buttons, requester gets told when it's done.
2. **Weekly summary + meeting + personal reminders** — the meeting page, assigning, reminders.
3. **Transportation + equipment** — read from Fleet and the gear register into items and the morning message. (Needs Fleet live first.)
4. **Hospitality + visiting teams** — rooms, stays, teams, room inspections.
5. **Buildings & spaces + events** — projects, space week view, event logistics.
6. **Innovations.**

Steps 1–2 alone give you the morning message, the weekly summary and the meeting flow, for maintenance.

## Decided (Gideon, 23 Nov 2026)

- Morning messages: one shared message per area in its Slack channel, plus a short DM to each person with only what's been given to them.
- Maintenance requests keep coming in through the existing Slack form.
- The operations meeting is **Wednesday 10:00**. The weekly summary goes to the team at close of work the day before — **Tuesday 17:00** — covering Wednesday to Tuesday.
- Build first: steps 1–2 (Maintenance + weekly summary, meeting and reminders).

## Questions still open

- Who is on the operations team, and who on maintenance / hospitality / buildings?
- Is a repair "Maintenance" or "Buildings" — where's the line? (Proposed: one-off fix = maintenance; planned work with stages or a budget = buildings project.)
- The existing Teams page is a placeholder for *ministry* team rosters. Visiting teams goes under Operations so the two don't collide — OK?
