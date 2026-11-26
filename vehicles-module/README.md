# Vehicles module: the FFSA Fleet app, ready to bring into the FFSA Hub

The **FFSA Fleet** app is what Gideon uses today to run FFSA's vehicle inspections: the weekly and monthly checks, km readings and service/bumper-to-bumper warnings, trips and rentals, workshop visits and booking clashes, in-car guides, a time tracker, a Guide with a handover tutorial, and **Ask** (chat with the app, by typing or speaking). It was built as a private claude.ai app.

This repo runs **that same app, unchanged, on your own machine or server**, with FFSA's real data loaded. Run it next to the Hub, click through it, then bring it into the Hub step by step.

## Quick start

Needs Node 18 or newer. No `npm install`: there are no dependencies.

```bash
cp .env.example .env      # optional: add an Anthropic API key to switch on Ask
npm run seed              # loads FFSA's data (17 Nov 2026) into ./data
npm start                 # http://localhost:8787
npm test                  # server + reminder tests (Claude is mocked; no key needed)
npm run reminder          # prints today's 7am reminder
```

Open http://localhost:8787 on your phone (same Wi-Fi, use your computer's IP) as well as on desktop: the app is phone-first.

Changes are saved in `./data`. `npm run seed -- --force` resets to the original data.

## What's inside

| Path | What it is |
|---|---|
| `app/ffsa-fleet.html` | The app, byte-for-byte as it runs on claude.ai (one file: HTML, CSS, JS). Don't edit it here until you start the Hub port. |
| `public/claude-shim.js` | Gives the app what claude.ai gave it, through `window.claude.use(...)`: database, file storage, user, downloads, Claude (Ask) and dictation. |
| `server/server.js` | Small Node server: JSON database with live updates, photo/PDF storage, the Ask proxy (keeps the API key on the server), optional password. |
| `server/store.js` | The database: Firestore-style documents, deep-merge updates, where/orderBy/limit queries. |
| `server/reminder.js` | The daily 7am reminder as code (today it's a Claude scheduled task, `docs/REMINDER_PROMPT.md`). |
| `server/seed.js` | Loads `seed/` into `./data`. |
| `seed/db/*.json`, `seed/files/` | FFSA's live data and its 19 photos/PDFs, exported 17 Nov 2026. |
| `docs/SPEC.md` | The module spec: roles, data model, every screen, the exact rules, Hub integration, migration, acceptance tests, build order. |
| `docs/content/*.json` | The checklist (124 points with help), vehicle profiles, in-car guide, rule numbers, and the Hub version of the Guide. |
| `CLAUDE.md` | Context for Claude Code. |
| `CLAUDE-CODE-PROMPTS.md` | Prompts to paste into Claude Code, one step at a time. |
| `UPGRADES.md` | Suggested improvements, most useful first. |
| `MESSAGE-TO-JACK.md` | A short note for Jack about what this is and what's needed from him. |
| `test/` | `npm test`, plus a mock Claude API for testing Ask without a key. |

## How it maps onto the Hub

| In this repo | In the Hub |
|---|---|
| `window.claude.use('db')` → `server/store.js` | The Hub's database. Collections: `fleet` (vehicles), `records` (workshop visits), `trips` (bookings), `providers` (workshops), `inspections`, `odometer`, `timelog`, `config` (`checklist`, `schedule`, `notify`) |
| `/api/stream` live updates | The Hub's realtime, or refetch after writes |
| `use('assets')` → `/api/assets`, `/_blob/<id>` | The Hub's file storage |
| `use('user')` → `APP_PASSWORD` sign-in | Hub login and the **Vehicle Co-ordinator** role |
| `use('sample')` → `/api/claude` | The Hub's server-side Claude call (same tools, same confirm step) |
| `trips` | Hub vehicle bookings |
| `server/reminder.js` | A Hub scheduled job at 07:00 SAST to the role holder, by Slack and email |

## Ask (Claude)

Ask is off until you set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in `.env`. The key stays on the server. The browser runs the tool loop: Claude can read the data in the prompt and call the app's own functions (log km, book a workshop, add a trip…), and **every change asks the user to confirm first**. Speaking works where the browser has speech recognition (Chrome, Edge, Android); elsewhere, use the keyboard's microphone.

## Privacy

`seed/` holds FFSA's vehicle details (registrations, VINs, engine numbers, insurer) and WeBuyCars and workshop reports. **Keep this repo private and inside FFSA.** Never commit `.env`. Set `APP_PASSWORD` on any server other people can reach.
