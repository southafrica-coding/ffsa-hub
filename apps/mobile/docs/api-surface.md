# FFSA Hub — what the native app can call, and what must change

Prepared 1 Nov 2026 from the repo tree (≈369 `route.ts` files, 15 Vercel crons) and the files I read in full (listed per row). Everything here is **read-only analysis; no repo or Supabase change was made.**

## 1. The one big blocker (plain English)
Today every protected API route trusts a **browser cookie** set by `@supabase/ssr`. A phone app has no cookie jar the web code recognises; it holds a **bearer token** (the Supabase access JWT). Specifically, in `src/middleware.ts`:
- Anything not on the public list that has no cookie session is **redirected (307) to /login** — a phone gets an HTML page, not a clean "401".
- It also does the **deactivated-user check** (`users.is_active`) — must apply to bearer callers too.
- Route handlers then call the cookie-based `createClient()` (`supabase-server.ts`) so `auth.uid()` and RLS work. With a bearer token there is no cookie, so `createClient()` sees nobody.

**Minimum change (decision I):** (1) middleware: if `Authorization: Bearer …` is present, skip the cookie redirect and return JSON 401/403 instead of redirects on `/api/*`; (2) one helper `createClientFromRequest(req)` that builds a Supabase client with `global.headers.Authorization` = the bearer token (so RLS still runs as the user) and is used by routes the app needs; (3) apply the `is_active` check on that path; (4) do **not** use the service-role client to "become" the user. CORS is not needed for native apps (they are not browsers); needed only if an Expo web build is ever shipped. (unverified against Next 15 edge behaviour — to be tested in a draft PR.)

## 2. Which things the app can do straight against Supabase (RLS enforces)
Uses `@supabase/supabase-js` with the user's session; same project URL + anon key as the web (public by design). Safe **only** where RLS is correct.
- Reads of own data: profile (`users`), `user_roles → roles(name)`, own permissions (`user_permissions`; `permissions`/`role_permissions` readable by any authenticated user), outreach teams/budgets/expenses as allowed by outreach policies, prayer-room sets, events/tickets the user may see, `notification_reads`.
- Receipt **file upload** to private bucket `outreach-receipts` (the web does exactly this, with the user client, path `${teamId}/${expenseId}/${Date.now()}_${file.name}`, `upsert: true`).
- Avatar upload (bucket `avatars`, migration 082).
Everything else below goes through the Next.js API.

## 3. Routes/flows the app needs (by feature) — auth today → change needed

| Feature | Endpoint(s) | Auth today | Server-only things it touches | Change for bearer app |
|---|---|---|---|---|
| Sign-in (email+password) | none — `supabase.auth.signInWithPassword` direct | Supabase Auth | — | none for sign-in itself. `POST /api/auth/login-attempt` (fire-and-forget audit, web calls it after each attempt): public? **(unverified)** — app should call it for parity |
| Forgot password / first-time setup | `POST /api/auth/forgot-password` (public) | none (public list) | Resend branded email, token_hash link | Email links point to **web** `/auth/confirm?token_hash&type=` — on a phone these must open the app (universal link / app link) or fall back to web. See §5 |
| Invite / recovery landing | `/auth/confirm` (page) handles `?code`, `?token_hash&type`, `#access_token`, `#token_hash` → `/reset-password`, `/onboarding`, `/dashboard` | cookie | — | App needs its own handler for the same four shapes (`exchangeCodeForSession`, `verifyOtp`, `setSession`) |
| Onboarding | `POST /api/onboarding/complete` | cookie | ? | bearer client |
| Session/deactivated check | middleware `is_active` | cookie | — | replicate for bearer; on `deactivated` the app must sign out and show a message (web: `/login?error=deactivated`) |
| My Finance — expenses | `/api/finance/outreach/expenses` POST/PUT/DELETE | cookie (`checkCashAlert(team_id)` fires via Next `after()`: cash-alert/Slack side effect) | **Slack/cash alert** | **Must go through the API**, not direct table writes, or the alert is silently lost |
| Receipts | `GET/POST/DELETE /api/finance/outreach/receipts` | cookie; GET reads rows by RLS then **signs URLs with service role (1 h)**; DELETE removes row by RLS then file with admin client | service-role storage signing | bearer client; flow = upload to bucket directly → POST metadata `{expense_id, file_path, file_name, file_size, mime_type}`. Offline queue candidate |
| Outreach budgets / lines / categories / day-plans / cash batches / fund releases / groups / team-members / teams / closeouts / reports / exchange-rate | `/api/finance/outreach/*` | cookie + `outreach-access.ts` helpers | Slack (bot), Xero? (**unverified**) | bearer client on each route the MVP uses. Approvals: see §4 |
| Prayer room | `/api/prayer-room/*` | cookie | ? | bearer client |
| Events I'm in / tickets | `/api/events/[id]/*`, `/api/tickets/[code]/qr` (public — the code is the auth), `/api/tickets/[code]/waiver` | mixed | PDF/QR generation | tickets QR already public by code (good for wallet display). Ticket purchase (Stripe/PayFast) — see plan K |
| **Staff check-in** | `GET ?stats=1`, `GET ?q=`, `POST {code}`, `POST {undo}` on `/api/events/[id]/check-in` | cookie session + `events.manage_attendance` (`getAuthedUser`, `canManageEvents`) | shared service `services/ticket-check-in` | bearer client only; JSON shape can be reused as-is |
| **Volunteer door scan (no account)** | same four verbs on `/api/scan/[token]` | **public**, token in path; in-memory rate limit 120/min per token+IP (ineffective on serverless) | service role inside | Works from an app unchanged. Needs a real rate limit before wider use. A "scan-link" is minted by `/api/events/[id]/scan-link` |
| Notifications feed | none for lists — derived server-side in `src/services/notifications.ts` for the dashboard; read-state `POST /api/notifications/read` (cookie) | cookie | stable keys e.g. `booking:<uuid>`; `notification_reads` table (096) | **New** `GET /api/notifications` returning the same derived feed (capped at 15 per provider) for the bearer user |
| Notification prefs | `/api/profile/notification-preferences` | cookie | — | bearer client |
| Push | **none exists** | — | — | New: `device_push_tokens` table, register endpoint, a sender (see plan E). Needs a migration (hand-applied by Jack) |
| Profile | `/api/profile/*` (cv, household, insurance, licence, notification-preferences, passport-photo, slack), `/api/account/*` | cookie | passport photos + sensitive docs | bearer client; sensitive-data screens are phase 3+ |
| Approvals (Coreen) | outreach `fund-releases`, `closeouts`, expenses status; staff approvals; booking decisions (`/api/bookings/*`) | cookie + role checks | Slack, email | **Scope first:** I did not find a single "approvals inbox" page for finance. `finance.approve` exists as a permission. Confirm with Jack/Coreen what she approves today. (unverified) |
| Bookings, vehicles, equipment | `/api/bookings/*`, `/api/vehicles/*`, `/api/equipment/*` | cookie | email/Slack | later phase |
| Dashboard layout | `/api/dashboard/layout`, `/staff-insurance`, `/vehicles` | cookie | — | later |
| Calendar | `/api/calendar/upcoming` | cookie | Google Calendar API key/OAuth (server) | later |
| AI assistant | `/api/assistant` | cookie | Anthropic | later; streaming over bearer needs checking |
| Uploads for applications | `POST /api/upload/sign` (**public, unauthenticated**), `/api/upload/view` (session; signs with service role) | none / cookie | bucket `application-uploads` (images only) | Not MVP. Security note: unauthenticated signer — rate-limit/abuse risk to flag to Jack |
| Public forms/applications/signup | `/api/public/*`, `/api/f/[slug]/submit`, `/api/fb/[slug]/submit`, `/api/scheduling/[token]` | public | email | not needed in the app (link out) |
| Admin (users/roles/permissions/merge) | `/api/admin/*`, `/api/users/[id]` | cookie + admin | service role | **Keep web-only** (least privilege) |
| Contacts/campaigns/communications | `/api/contacts/*`, `/api/campaigns/*`, `/api/email-templates` | cookie | Resend, AI polish | web-only for now |
| Xero | `/api/integrations/xero/*` (connect, callback, webhook, invoices) | connect has **no auth** (earlier note); webhook public | Xero OAuth, two orgs (ZA, US) | **never call from the phone**; server-only |
| Stripe / PayFast / Resend webhooks | `/api/integrations/*` | public + signature | secrets | server-only |
| Slack | `/api/slack/*` | Slack signing secret | Slack apps | server-only |
| Crons | `/api/cron/*` (15) | `CRON_SECRET` bearer | many | server-only |

## 4. Server-only secrets (from `.env.example`) — **must never ship in the app**
Xero (client id/secret, tenant ids), Stripe secret + webhook secret, PayFast merchant id/key/passphrase, Resend key + webhook secret, Slack tokens/signing secrets, Google Calendar OAuth, Anthropic key, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET`. The app embeds **only** the Supabase URL + anon key (public) and the API base URL.

## 5. Deep links the app will need
Invite and recovery emails link to `https://www.ffsahub.com/auth/confirm?...` (or `/reset-password`). On a phone these need **universal links (iOS) / app links (Android)** → requires hosting `apple-app-site-association` and `assetlinks.json` on www.ffsahub.com (two small static files in the web repo) and the app handling the four token shapes. Fallback: the link opens the web page, which still works.

## 6. Suggested API additions (draft-PR scope for the web repo)
1. `GET /api/me` → `{ user, roles[], permissions[] (effective, role-expanded), modules[] , is_active }` — one call so the app doesn't reimplement `getAccessibleModules`.
2. Bearer support in middleware + `createClientFromRequest`.
3. `GET /api/notifications` (+ `POST /api/notifications/read` over bearer).
4. `POST /api/devices` (register/unregister push token) + server push sender.
5. Version header `X-App-Version` / `GET /api/mobile/config` returning `minimum_supported_version` (kill switch for old builds).
6. Rate-limit upgrades for `/api/scan/[token]` and `/api/upload/sign` (shared store, not in-memory).
