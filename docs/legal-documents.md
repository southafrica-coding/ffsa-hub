# Legal → Documents — plan

One place in the Hub for FFSA's legal and compliance papers and the legal
officer's own papers: what we hold, what it says, when it runs out, and what
is being applied for. Built for the legal officer (Coreen). Reminders by email
and on the Hub dashboard.

Status: **steps 1–6 written, not applied.** Migrations 370–375 are drafts.
Do not run them until Jack says so. Until they are applied the page sends
everyone to the dashboard and the menu entry stays hidden.

Where it lives: **`/legal-documents`** (System → Documents in the sidebar).
Not under `/legal/`: that path is public in `src/middleware.ts`.

---

## Who can open it

A short, named access list (`legal_access`), and nothing else.

| Who | Why | Until |
| --- | --- | --- |
| Coreen (owner) | It is her module | — |
| Gideon (reviewer) | Building and testing | Go-live |
| Jack (reviewer) | Building and testing | Go-live |

- **No role gets in.** `is_admin()`, `super_admin` and `legal_admin` appear in
  no policy. Coreen is a super admin herself, so a role-based rule would let
  every other super admin in. Same hard wall as the Missio tables (329).
- Reviewers have the same rights as the owner while we build, so they can
  correct what they find. Coreen has agreed to this, personal papers included.
- **Before go-live:** delete the two reviewer rows (or set `ends_on`).
- Only the service role can change the access list in step 1. Coreen
  managing helpers herself (per folder, view or edit, with an end date) is a
  later step; the table already has room for it.
- Accounts must be active (`users.is_active IS NOT FALSE`), as in 313.

## What it holds

- **Folders** — standing areas (*FFSA legal*, *Coreen — personal*) or
  projects (*PBO renewal 2027*). Kind: `organisation`, `personal`, `project`.
- **Document types** — a catalogue (NPO certificate, tax compliance PIN,
  passport …) with a usual validity and a usual lead time. The seed is a
  **draft list for Coreen to confirm**; nothing in it is a legal deadline.
- **Documents** — one row per thing held or needed: holder, issuer, reference
  number, issued, expires, how many days ahead to start renewing, status
  (`held`, `applying`, `not_held`, `superseded`, `cancelled`). A renewal
  points at the document it replaces.
- **Files** — scans and PDFs in the private `legal-documents` bucket at
  `<folder id>/<file id>.<ext>` (no names in paths). A scan can arrive before
  it is matched to a document; it then sits in its folder unmatched.
  Each file keeps its **extracted text** and the **fields read from it**
  (reference number, dates, issuer), each with a review flag, so what was
  read is never taken as fact until a person confirms it.
- **Applications** — anything being applied for or renewed: lodge-by date,
  submitted, expected, closed, outcome, and a checklist of steps.
- **Event log** — every change to documents, files, applications and steps,
  with who made it. Append-only. Three people editing at once need this.

## Expiry rules (step 2, `src/lib/legal/`, tested)

- `expired` — `expires_on` is before today (Johannesburg date).
- `expiring` — within `renew_lead_days` of `expires_on`.
- `valid` — otherwise; `no_expiry` when `expires_on` is null.
- A document with a newer one superseding it is never flagged.
- An open application on a document turns "expiring" into "in hand".

## Steps

1. **Data layer** — migrations 370 (schema), 371 (RLS, grants, bucket),
   372 (draft types, the access list, starter folders); `src/services/legal-documents.ts`.
2. **Screens** — done. One page with four tabs (Needs attention,
   Documents, Applications, Folders) and the 470 px drawer for a document
   (details, scans, applications, history), an application (checklist,
   details, history) or a folder (scans to match, details, archive).
   Single scans can already be added to a document or a folder: the API
   adds the row as the user, then signs a one-time upload, and the browser
   sends the file straight to storage (no 4.5 MB serverless limit).
   Routes under `/api/legal/*`; rules in `src/lib/legal/status.ts` (tested).
3. **Scanning in** — done. *Scan in* (masthead) takes many scans into a
   folder; each is read as it lands, one at a time. Claude Opus 5.5 reads a
   copy (same set-up as the Slack receipt reader) and returns the full
   text (first 8 pages), a short summary, *things to watch* taken from
   the paper, and suggested details (type, title, holder, issuer,
   reference number, issue and expiry dates), each marked sure or not.
   All of it is stored on the file as **unconfirmed** suggestions.
   The scan review drawer pre-ticks only what the reader was sure of,
   lets the person correct any value, suggests which document it belongs
   to (same reference number → same type → same title; a later expiry
   than the one on file means a renewal, so a new document), and writes
   nothing until **Apply**. The summary and things to watch can be added
   to the document's notes, marked as read by Claude.
   Limits: PDFs over 22 MB are kept but not read; iPhone HEIC photos
   can't be read here (scan to PDF or JPG). The installed SDK (0.98)
   has no server-side refusal fallback, so a declined scan says so and
   is filled in by hand. Routes: `/api/legal/files/[id]/read` and
   `/apply`. Rules: `src/lib/legal/reading.ts` (tested).
4. **Reminders** — done. **Switched OFF until Gideon and Jack say to
   activate it:** it sends only on production with
   `LEGAL_REMINDERS_ACTIVE=1`; until then every run is a dry run.
   `/api/cron/legal-reminders`, 05:00 UTC (07:00 Johannesburg), emails the
   **owner** only (not reviewers or helpers). Rules (Gideon, 18 Nov 2026):
   - **Colours:** green at 90 days, yellow at 60, orange at 30, red at 7
     and after. Applications: the same colours at 21 / 14 / 7 / 2 days
     before lodge-by; red once past the expected date. Shown in the email,
     on the Documents lists (left edge of each row) and the dashboard card.
   - **Documents:** 90, 60, 30 and 7 days before expiry and on the day,
     for every document. Once a renewal is under way (an open application
     for it, or status "applying") the 90/60/30 reminders are skipped and
     only 7 days and the day itself still come up.
   - **Expired documents and applications late to lodge:** every Monday,
     Wednesday and Friday. Lodged applications past their expected date:
     Mondays (they are waiting on someone else).
   - **Applications:** 21, 14, 7 and 2 days before lodge-by and on the day.
   - **A day with reminders:** those, then everything else still open.
   - **A quiet day** (no reminder hits): the next 5 things coming up —
     only on quiet days. A quiet Monday also lists everything still open.
   - Nothing when there is nothing open and nothing dated; archived
     folders are quiet.
   Titles and dates only — no reference numbers, holders or notes. The day
   is claimed in `legal_reminder_sends` (migration 373) before sending.
   **Preview:** Needs attention → *Preview today's email*
   (`/api/legal/reminder-preview?date=YYYY-MM-DD` to try another day).
   **Dashboard:** a *Legal papers* card for people on the access list —
   not a band, because the dashboard's one band is staff approvals.
   Rules: `src/lib/legal/reminders.ts` (tested).

5. **Legal helper and drafts** — done. Migration 374.
   - **Ask the helper** (masthead) opens a chat on Claude Opus 5.5. It
     reads documents, scan text, applications and drafts, and can save
     or update a **draft** — nothing else. No approve, send or delete tool
     exists. Every tool runs as the signed-in person (RLS), so it sees only
     what they may see. Scan text is treated as data, never instructions.
   - **Filling out forms:** scan the blank form in, then ask. It answers
     field by field in the form's order, each with its source; anything
     the Hub doesn't hold is marked missing (never guessed) and listed in
     "Check before approving". Letters mark gaps as `[MISSING: …]`.
   - **Where it saves:** it picks the folder (organisation / personal /
     project) and attaches the document or application the draft belongs
     to; the legal officer can change it before approving.
   - **Approval:** the Drafts tab. Only the OWNER (legal officer) can
     approve or send back; reviewers can draft and edit. The rule is in
     the database (trigger in 374): nothing starts approved, only the
     owner's own session can approve (not the service role), an approval
     must name its PDF, and an approved draft never changes or goes away.
     Approving renders a PDF (`src/lib/legal/draft-pdf.tsx`), files it in
     the folder under the document, and records who and when.
   - **Privacy:** the chat is not stored (unlike the Hub assistant, which
     logs to `ai_assistant_queries`); only token counts reach the log.
   - Not yet: writing into an official PDF's own form fields. The approved
     PDF is FFSA's completed answer sheet; copying it onto the issuer's
     form or portal is still done by hand.

6. **Voice and background work** — done (night of 18 Nov 2026, not pushed).
   Migration 375.
   - **Talk** (microphone) in the helper: speak a question; it's sent when
     you stop. **Reading aloud** reads answers out, kept short and spoken
     naturally (dates in words, no symbols or ids; long answers say "the
     rest is on the screen"). **Hands-free** listens again after each
     answer; "that's all" ends it. Uses the browser's own speech: Chrome
     and Edge send the audio to Google to turn into text, Safari to Apple;
     the Hub never receives or stores audio. Reading aloud runs on the
     device. Firefox can't listen (typing still works). South African
     English (en-ZA) is asked for, British English as fallback.
   - **Background tasks:** the helper hands bigger jobs ("prepare the PBO
     renewal pack", several forms, many scans) to the background with its
     `start_background_task` tool, or the person presses *Work on this in
     the background* / ends a spoken request with "in the background". A
     task runs in its own request after the reply (`next/server` after()),
     as the person who asked, for up to ~4½ minutes at high effort, saves
     drafts as it goes, and ends with a short report. Closing the page
     doesn't stop it. Progress shows live in *Working on* (helper) and
     *Helper tasks* (Drafts tab); **Stop** cancels between steps; a task
     with no heartbeat for 6 minutes shows as stopped and can be run again.
     With reading aloud on, the page says when a task finishes.
   - **Spending guard:** at most 2 tasks working at once and 15 a day per
     person (`task-state.ts`). The chat itself has no daily cap yet.
   - A task can't start more tasks. Tasks are stored (they must be, to run
     unattended) behind the same wall: whole-module members only.

Ideas for the next round (not built — for Gideon to decide):
- **FFSA facts sheet:** one page of confirmed facts (registered name,
  NPO/PBO/tax/CIPC numbers, addresses, signatories, year end) that the
  helper uses first for every form. The biggest gain in accuracy: today it
  pieces these together from scans each time.
- **Morning briefing:** opening Documents (or a dashboard button) reads a
  30-second spoken brief: what's due, what's waiting for approval, what the
  background tasks finished. Built from the reminder rules; no AI needed.
- **Renewal plans:** the helper proposes an application with its checklist
  (steps and dates) as a draft; one tap on approval creates it.
- **Filling the issuer's own PDF form:** when SARS/CIPC/DSD forms are
  fillable PDFs, write the approved answers into the form itself. Needs a
  new library (pdf-lib), so needs a yes first.
- **A natural voice:** a cloud text-to-speech voice instead of the
  device's. Better sound, but a new service, key and cost.
- **Talk from anywhere:** a microphone on the dashboard card / phone tab
  bar that opens the helper hands-free.
- **Tell me when it's done:** an email or Slack note when a background
  task finishes. Sends messages, so only with Gideon's OK.
- **A daily cap on the chat** (like the Hub assistant's), with token
  counts stored per person.

Not now: Google Calendar; helpers chosen by Coreen; sharing outside the Hub.

## Open questions for Coreen

- Confirm or correct the draft document types and lead times.
- The folders she wants to start with.
- Which address reminders go to (her Hub account is the legal@ mailbox).
