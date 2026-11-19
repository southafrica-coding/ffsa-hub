# CLAUDE.md: FFSA Fleet (to be brought into the FFSA Hub)

## What this is

The FFSA Fleet app (`app/ffsa-fleet.html`) runs FFSA's vehicle inspections. It was built as a private claude.ai app and runs here unchanged: `public/claude-shim.js` and `server/` give it what claude.ai gave it. The goal is to bring it into the FFSA Hub so the Vehicle Co-ordinator works in one place, **without making it any harder to use**.

Read `docs/SPEC.md` first. It is the source of truth for roles, data, screens, rules, Hub integration, acceptance tests and build order.

## Non-negotiables

1. **As easy as it is now.** Phone-first (390 px, no sideways scroll), one tap per checklist point, plain-language help on every point, nothing typed twice.
2. **Time budget.** The co-ordinator's inspections and booking management take at most 4–5 hours a week (workshop time is not theirs). Automate what a computer can do.
3. **Keep the Guide updated with every change.** Any change to behaviour or screens must update the Guide text and add a dated line to "What's new":
   - in `app/ffsa-fleet.html`: `GUIDE_PAGES` and `GUIDE_CHANGES` (search for `MAINTENANCE RULE`);
   - in the Hub: the Guide rendered from `docs/content/guide-hub.json` (SPEC section 8).
   A change isn't done until the Guide matches it.
4. **Rules don't change silently.** SPEC section 6 is exact. If a rule looks wrong, ask Gideon; don't "fix" it.
5. **Every change Ask makes is confirmed by the user first** (`chatConfirm`).

## Commands

```bash
npm run seed            # load seed/ into ./data   (-- --force to reset)
npm start               # http://localhost:8787
npm test                # node:test, server + reminder; Claude is mocked (test/mock-claude.js)
npm run reminder        # today's reminder; --date YYYY-MM-DD, --json, --post (SLACK_WEBHOOK_URL)
node test/mock-claude.js 8788   # fake Claude API; then ANTHROPIC_BASE_URL=http://localhost:8788, any key/model
```

No dependencies. Node 18+.

## How the pieces fit

```
browser                                         server/server.js (Node, no deps)
app/ffsa-fleet.html  --window.claude.use()-->  public/claude-shim.js
   db         collection/doc/where/orderBy/limit/get/onSnapshot/set/update/delete  -> /api/db, /api/stream (SSE)
   assets     upload/list/delete                                                   -> /api/assets, /_blob/<id>
   user       id/name/can/profiles                                                 -> /api/config (APP_PASSWORD basic auth)
   downloads  save({filename, data})                                               (browser download)
   sample     Claude with page tools; tool loop runs in the browser               -> /api/claude -> Anthropic Messages API (streamed)
   dictation  start/stop/onPartial/onFinal/onState                                 (Web Speech API; null where missing)
```

Database semantics the app relies on (keep them when you swap in the Hub's database):
- `set` replaces the whole document; `update` **deep-merges** nested objects into an **existing** document (arrays replace; a missing document is an error). Example: `update({cardPrinted:{stale:true}})` must keep `cardPrinted.date` and `.sig`.
- Queries: `where` with `==` (also `>=` on `timelog.date`), one `orderBy`, `limit`. Without `orderBy`, results come in document-id order.
- Live: every open page sees every write within a second (`onSnapshot`).
- Files are referenced in documents by id and shown as `/_blob/<id>`.

Paths are absolute: the app loads files from `/_blob/<id>` (function `blob()`, line ~1472) and the shim calls `/api/db`, `/api/stream`, `/api/assets`, `/api/claude`, `/api/config`. Inside the Hub (e.g. under `/vehicles`) either serve those exact paths or change `blob()` and the URLs at the top of `public/claude-shim.js` to the Hub's routes. Routing inside the app uses the URL hash (`#today`, `#v-crv`, …), so it works under any base path.

Drafts, the chat history and tutorial progress are kept in the browser's `localStorage` (keys starting `ffsa-`), per device.

Collections: `fleet` (vehicles), `records` (workshop visits, `status` booked|done), `trips` (trips and rentals; Hub bookings replace these), `providers` (workshops), `inspections`, `odometer`, `timelog`, and `config` documents `checklist`, `schedule`, `notify`. Fields: SPEC section 4.

## Map of `app/ffsa-fleet.html` (about 3 700 lines; line numbers approximate)

| Area | Where |
|---|---|
| Checklist points, help text, route, model profiles, in-car guide text | `RAW` 552, `DEFAULT_CHECKLIST` 699, `HELP` 750, `GUIDE` 887, `ROUTE` 998, `PROFILES` 1012, `CARD` 1089 |
| Constants and rule numbers | `STATUS` 722, `KM_RULES` 729, `EST_MIN` 1652 |
| State | `S` 1480 |
| Km plan and alerts | `kmPlan` 1520, `kmAlerts` 1538, `odoPatch` 1720, `kmRate` 1726 |
| Routine check due (weekly/monthly, postponements) | `weekly` 1573 |
| Needs attention | `vehicleAlerts` 1602, `attentionFor` 1143 |
| Clashes, similar vehicles, free 48 hours | `suggestGap` 1669, `alternatives` 1680, `clashList` 1684 |
| Time tracker | `tickDraft` 1766, `logTime` 1771, `timePanel` 1778 |
| Today | `todayTasks` 1800, `todayView` 1832 |
| Calendar | `calendarView` 1846 |
| Ask | `CHAT` 1888, `chatSnapshot` 1918, `chatInstructions` 1931, `chatTools` 1951 (14 tools), `chatSend`, `initAsk` |
| Guide | `GUIDE_CHANGES` 2176, `GUIDE_PAGES` 2192, `guideView` 2280 |
| Boot, data subscriptions, routing | `boot` 2316, `subscribeCore` 2336, `parseHash` 2378, `render` 2421 |
| Screens | `fleetView` 2480, `vehicleView` 2510, `inspectFormView` 2667, `guidedHTML` 1287, `scheduleView` 3207 |
| Saves | `saveInspection` 2793, `saveRecord` 3021, `saveTrip` 3340 |
| PDFs (in-car guide, manual, guide) | `cardDoc` 1363 (pdfmake from a CDN) |
| Click/change handlers | `H` 3451, listeners from 3611 |

`server/reminder.js` re-implements the reminder rules as small pure functions with tests. Prefer it as the shared rules module in the Hub (SPEC 6.1, 6.2, 6.4, 6.6, 6.9, 6.11).

## Bringing it into the Hub

**Decided (17 Nov 2026): a native rebuild, not an embed.** The app is rebuilt in the Hub's own stack and look as **Fleet**, under Bookings → Vehicles → Fleet (`/bookings/vehicles/fleet`). `app/ffsa-fleet.html` is the reference for flow, rules and text and is not served by the Hub. The plan is `HUB-PLAN.md`; the prompts, one pull request each, are in `CLAUDE-CODE-PROMPTS.md`:

1. **Foundations:** role and permissions, `fleet_` tables with RLS, `fleet-files` bucket, the rules as pure TypeScript with tests, the seed import.
2. **Core screens:** Vehicles, Vehicle page, Inspection, Workshops, Checklist, Guide.
3. **Daily work:** Today, Calendar, Schedule, time tracker, Settings; then the SPEC section 10 check side by side with this app, and go-live.
4. **07:00 reminder** to the Vehicle Co-ordinator role by Slack and email.
5. **Bookings** (SPEC section 7). Hub bookings replace `trips` from step 1 onwards.
6. **PDFs** with `@react-pdf/renderer`.
7. **Ask** (optional).

In the Hub, the Guide is rendered from `docs/content/guide-hub.json` (copied to `src/lib/fleet/content/`); that copy is what non-negotiable 3 refers to there, not `GUIDE_PAGES` in the HTML file. Use `docs/content/*.json` as-is and port the rule functions without changing them.

## Don'ts

- Don't put `seed/` or `data/` anywhere public. They hold FFSA's vehicle and insurer details and workshop reports.
- Don't send the API key to the browser; Claude calls go through the server.
- Don't let tests or dev runs send real Slack messages or emails.
- Don't rename data fields without a mapping; the rules and the reminder read them by name.
- Don't drop the confirm step from Ask or let it delete things.
