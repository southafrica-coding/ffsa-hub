# FFSA Hub — feature inventory for the native app

Prepared 1 Nov 2026 from the repo tree (≈137 `page.tsx` screens, ≈369 API routes) plus files read in full. Sizes are rough "screens + effort" guesses, not estimates from code reading of every page; I read the code of: auth, modules/nav, mobile tab bar, outreach receipts/expenses, check-in/scan, upload routes, notifications service. Others are inferred from route names — **marked (inferred)**.

**Status key (3 Nov 2026):** Done = merged · In progress = being built in a Phase 1 slice PR (shell+home+me, finance+receipts, tickets+check-in) · Planned = Phase 1 but not in a slice yet · Later = Phase 2+ or web-only.

**Priority key:** P1 = MVP (phase 1) · P2 = phase 2 · P3 = phase 3 · W = stay web-only (admin-heavy, desktop-shaped, or sensitive).
**Size key:** S ≈ 1–3 screens, M ≈ 4–8, L ≈ 9+.
**Data key:** DB = Supabase direct under RLS · API = via Next.js route · SRV = needs server-only secret/side-effect.

## A. Everyone (portal group) — the natural phone core
| Module / route | What it is | Gating | Data | Size | Priority | Status |
|---|---|---|---|---|---|---|
| Sign-in `/login` | email+password, 5-fail/30 s cooldown, deactivated-account bounce | public | Auth + API (login-attempt) | S | **P1** | Done (scaffold, #478) |
| Forgot/reset/first-time setup `/forgot-password`, `/reset-password`, `/auth/confirm`, `/onboarding`, `/setup/[token]`, `/join/[code]` | invite + recovery via emailed link | public | Auth + API | M | **P1** (deep links) | Planned |
| Me `/profile` | profile, CV, household, licence, insurance, passport photo, Slack link, notification prefs, security `/account/security` | any signed-in | DB+API | L | P1 basic (name, photo, notification prefs), P3 sensitive docs | In progress |
| My Finance `/my-finance`, `/my-finance/outreach/[teamId]` | person's outreach teams, budget lines, expenses, receipts | open to every user; team-scoped by RLS | DB+API, SRV (Slack cash alert, receipt signing) | L | **P1** | In progress |
| My Schools `/my-schools`, `/my-schools/[enrollmentId]`, `/my-schools/apply/[programId]` | enrolments, course info, apply | any | DB+API | M | P2 (tab exists on web phone bar) | Later |
| My Events `/my-events` | registered events, tickets/QR | any | DB+API | M | **P1** (tickets QR) | In progress |
| My Attendance `/my-attendance` | attendance record (inferred) | any | DB | S | P2 | Later |
| My History `/my-history` | activity history (inferred) | any | DB | S | P3 | Later |
| My Mission `/my-mission` | **hidden placeholder on web** | — | — | — | skip | Later |
| Prayer Room `/prayer-room` (+ preview pages) | weekly wall, sets, seats, practice bookings, evaluator tabs | open to all; evaluator/admin parts permission-gated | DB+API (RPCs + exclusion constraints in DB) | L | P2 (mobile layout already designed: frames 11a/11b) | Later |
| Dashboard `/dashboard` | derived notification feed ("needs you"), shortcuts | open | API (server-built feed) | M | **P1** (new /api/notifications) | In progress |
| Notifications | derived list with read-state (`notification_reads`) | open | API | S | **P1** | In progress |
| OKRs `/okrs`, `/okrs/[ownerId]`, `/okrs/cycles` | objectives | open (`okrs.view`, leadership) | DB+API | M | P3 | Later |
| Account `/account/confirm-email`, `/account/security` | email change confirm, password/2FA (2FA PR #293 open) | signed-in | Auth | S | P2 | Later |

## B. Staff / events operations
| Module | What | Gating | Data | Size | Priority | Status |
|---|---|---|---|---|---|---|
| Events `/events`, `/events/[id]`, `/events/new` | event admin, tickets, promo, orders, refunds | `events.*` / events_admin / admin | API, SRV (Stripe/PayFast refunds) | L | W (admin parts) | Later |
| **Check-in `/events/[id]/check-in`** | door scanner: camera QR, name search, stats, undo | `events.manage_attendance` | API (`/api/events/[id]/check-in`) | M | **P1** | In progress |
| Public scanner `/scan/[token]` | volunteer door scan with no account | token | API `/api/scan/[token]` | S | P2 (works in app or web) | Later |
| Event feedback/forms `/events/[id]/feedback/…`, `/forms/…` | forms + responses | `events.*` | DB/API | M | W | Later |
| Bookings (spaces, vehicles, equipment) `/bookings/**` | requests, approvals, calendar board, vehicle collect/return/agreement | `bookings.*`, `vehicles.*`, `equipment.*` | DB+API, SRV (email/Slack) | L | P2 requests+approvals+collect/return (camera photos), rest W | Later |
| Staff decisions `/staff-decisions` | leadership-only | role `leadership_team` | DB | S | P3 | Later |
| Ministries `/ministry/**` | ministry & staff views | `ministry.access` | DB | M | P3 | Later |
| Training `/schools`, `/schools/[programId]` | program admin | schools perms / program_leader | DB+API | L | W (attendance taking = P3) | Later |
| Org chart `/org-chart` | people tree | admin / `org.view` | DB | S | P3 | Later |
| Contacts `/contacts/**` | CRM, duplicates, import, lists, follow-up | staff/admin/contacts perms | API, SRV | L | W (maybe quick-lookup P3 via `/api/people/quick-view`) | Later |

## C. Finance office (Coreen's world)
| Module | What | Gating | Data | Size | Priority | Status |
|---|---|---|---|---|---|---|
| Outreach finance `/finance/outreach`, `/[teamId]`, `/groups` | teams, budget, cash batches, fund releases, closeouts, reports | `finance.view/edit`, `finance_admin`, per-team access | DB+API, SRV (Slack, maybe Xero) | L | P1 for **receipt-matching + approvals** (scope to confirm), rest W | Planned |
| Finance home `/finance` | module index | open (everyone sees outreach) | DB | S | P1 | Planned |
| School fees `/finance/school-fees/**` | billing, students, Xero matching, payments | finance roles | API, SRV (Xero, PayFast/Stripe) | L | W | Later |
| Donor statements `/finance/donor-statements` | statements | `finance.donor_statements` | API (PDF) | M | W | Later |
| Xero / Stripe / PayFast / Resend | integrations | admin | SRV | — | W — never in app | Later |

## D. Admin / system — **web only** (least privilege; keeps sensitive tools off phones)
Users & roles `/users/**`, `/roles`, `/settings`, `/settings/slack`, Consents `/consents`, Records Library `/records-library/**`, Brand Kit `/brand-kit`, Communications `/communications/**` (campaigns, inbox, automations, domains, identities, labels), Evangelism/Teams/Mission placeholders.

## E. Public pages (no login) — link out from app, do not rebuild
Public event pages `/e/[slug]` (ticket storefront), apply `/apply/[programId]`, forms `/f`, `/fb`, `/hire/**`, `/subscribe`, `/unsubscribe`, `/preferences`, `/reference/[token]`, `/schedule/[token]`, `/vr/[token]`, `/track-intent/[token]`, `/legal/*`, `/t/[tag]`, `/print/*`. Note: ticket **purchase** is on these web pages; see plan K for Apple rules if purchase moves into the app.

## F. Rough totals
- Phone-relevant authenticated screens: about 40–55 (P1+P2+P3).
- Roughly 60 % of the web's 137 pages are admin/desktop-shaped → W.
- API routes the app would call: about 40–60 of ≈369.

## G. Things I did not verify
- Whether realtime subscriptions (Supabase Realtime) are used anywhere — no evidence found in tree paths; code-search was unavailable (GitHub `search_code` returned incomplete results). 
- Exact contents of every portal page (My Attendance/History/Schools).
- Whether an "approvals" inbox for Coreen exists on web (see api-surface.md).
