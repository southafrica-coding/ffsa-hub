# FFSA Hub — native phone app (iOS + Android): plan and decisions

Prepared 1 Nov 2026 for Jack Kilman. **Status: plan only. Nothing has been written to GitHub or Supabase; nothing sent to anyone.** Companion files in this folder: `feature-inventory.md`, `api-surface.md`, `permissions-matrix.md`, `design-tokens.md`.

Plain-English glossary used below
- **RLS** (row-level security): rules inside the Supabase database that decide which rows each signed-in person may read or change. The phone would use the same rules as the website.
- **Bearer token**: the "ticket" a signed-in phone carries and shows to a server. Website sessions use a browser cookie instead; phones can't use that.
- **EAS**: Expo's paid cloud service that builds the iOS/Android app files and submits them to the stores, so you do not need a Mac to build.
- **OTA update**: pushing a small fix to installed apps without a store review.
- **TestFlight / internal testing**: Apple's and Google's private test channels.

---

## 1. What I found (the short version)

1. **The website is a Next.js app with ~369 API routes and ~137 pages, one npm package, no monorepo.** Auth is Supabase email+password, with the session kept in a **browser cookie**. (`package.json`, `src/middleware.ts`)
2. **The big blocker: almost all API routes only recognise the cookie.** A native app must send a bearer token, so the web repo needs a small, careful change (middleware + one helper). That is the single most important piece of backend work. (api-surface.md §1)
3. **Everything secret stays on the server** — Xero (two orgs), Stripe, PayFast, Resend, Slack, Google Calendar, the AI assistant, and the Supabase service-role key. The app never holds these; it holds only the public Supabase URL + anon key and calls the website's API where a server-side step is needed.
4. **The app can talk to Supabase directly for reads and for uploading receipt photos** (that is exactly what the website does), under the same permissions (RLS). Writes with side effects (e.g. saving an expense triggers a Slack cash-alert) must go through the API.
5. **Permissions are in the database** (roles → permission bundles, plus direct grants), enforced by RLS and mirrored in TypeScript for menus. The app can inherit this unchanged. A few existing gaps (e.g. role-bundle grants ignored by one helper) would be inherited too. (permissions-matrix.md)
6. **No push notifications, no web-push/PWA, no i18n (English only), and no evidence of Supabase Realtime.** (Based on file paths + package.json; code search was unavailable — mark as **unverified**.) The dashboard "needs you" feed is *computed on the server* at page load, not stored as events — so push needs a new trigger layer.
7. **The web already has a phone design** — a 4-tab bar (School · Finance · Prayer · Me), 48 px targets, and "mobile matters (students and volunteers)" is written in `CLAUDE.md`. The visual identity is brutalist/editorial: light-only, square corners, no shadows, one yellow "needs you" band.
8. **Door check-in and receipt capture are the best "native wins"**: both already exist as clean JSON endpoints and need a camera, which a native app does far better than a web page.

## 2. Phases (what Jack gets at each)

Time figures are **my rough guesses for a build driven by headless Claude Code with Jack reviewing PRs** — not commitments. All repo changes are draft PRs only; migrations are hand-applied by Jack; nothing merges, deploys or publishes without his OK.

### Phase 0 — Groundwork (≈1–2 weeks, parallelisable)
*Jack gets:* decisions made, accounts opened, an empty app that runs on his phone, and a draft web PR proving bearer-token sign-in works.
- Decide A–K below.
- **Start the store accounts early** — the slow part is Apple's/Google's organisation checks and the D-U-N-S number (up to 5 business days + 2 for Apple to receive it, per Apple). (F)
- Web repo, *draft PR #1*: bearer-token support in middleware, `createClientFromRequest()`, `GET /api/me`, JSON 401s on `/api/*`, deactivated-user check on the bearer path, `apple-app-site-association` + `assetlinks.json`. Tests with vitest.
- New `apps/mobile` Expo project (TypeScript, expo-router), design tokens + base components, CI (typecheck, lint, unit tests), first **EAS development build** on Jack's phone.
- Dump the live roles/permissions tables (read-only query) and reconcile `permissions-matrix.md`.

### Phase 1 — MVP (≈4–6 weeks)
*Jack gets:* a TestFlight + Android internal-testing build that a pilot group (staff, finance office, a few students) can use daily.
- Sign-in with email+password, session kept in secure storage, **Face ID / fingerprint unlock**, "forgot password" and invite/recovery links that open the app.
- Home with the **"needs you" feed** (new `GET /api/notifications`) and the 4-tab bar.
- **My Finance**: outreach teams → budget lines → expenses; **receipt capture by camera** (photo → private `outreach-receipts` bucket → metadata through the API), tied to a budget line; retries if the signal drops.
- **My Events / tickets**: QR for the logged-in person.
- **Staff door check-in** (camera scan, name search, stats, undo) using the existing check-in endpoint.
- Profile basics + notification preferences, account deletion request path.
- Kill-switch/minimum-version check.

### Phase 2 — Daily-driver (≈4–6 weeks)
*Jack gets:* push notifications and the approvals people were waiting for; public store release.
- **Push notifications** (Expo push → APNs/FCM): booking decisions, approvals waiting, expense/receipt flags, event reminders. Needs one new table + sender (hand-applied migration). (E)
- **Approvals for Coreen** (scope to confirm — see Question G): approve/flag expenses, fund releases, closeouts, booking/vehicle requests.
- Prayer Room (mobile layout already designed), bookings/vehicles requests + vehicle collect/return photos.
- Account security (2FA, once PR #293 lands on web).
- Offline outbox hardened; dark mode; accessibility audit.
- App Store + Google Play **production release** (staged rollout).

### Phase 3 — Breadth (open-ended)
My Schools, attendance, OKRs, staff decisions, ministries, org chart quick-look, sensitive profile documents, optional ticket purchase in-app (see K), widgets/wallet passes.

### Always web-only (by design, least privilege)
Users/roles/permissions admin, Xero/Stripe/PayFast/Resend/Slack setup, communications/campaigns, Records Library, Brand Kit, consents console, school-fees billing.

---

## 3. Decisions for Jack (A–K)

Each: options → tradeoff → my recommendation. "Evidence" cites what I read.

### A. Framework
| Option | For | Against |
|---|---|---|
| **Expo / React Native + TypeScript** | Same language (TypeScript) and same `supabase-js`, `zod` 4, React 19 mindset as the website, so types and validation can be shared; one codebase for both phones; EAS builds iOS without a Mac; OTA fixes; Claude Code is strong in TS/React. SDK 58 (14 Oct 2026) is on RN 0.88 and the New Architecture is mandatory since SDK 55 (per Expo's docs/search summary) | Not "pure native"; occasional native-module friction; brand look needs custom components |
| Flutter | Excellent UI/animation, one codebase | New language (Dart), no code sharing with the web, separate Supabase client, smaller pool of shared know-how here |
| Native Swift + Kotlin | Best platform feel and access | **Two** codebases/two skill sets (≈2× cost); no sharing; slowest to keep in feature-parity |
**Recommendation: Expo + TypeScript + expo-router.** Native views (not a web wrapper), so it passes Apple's "not a repackaged website" test (guideline 4.2). Evidence: web is TS 5.9 / React 19 / zod 4 / supabase-js 2.x; check-in and receipts need device camera (expo-camera).

### B. Same repo or new repo
| Option | Tradeoff |
|---|---|
| **Same repo, `apps/mobile` folder** | One place for web + app + shared types; one PR can change API and app together. Risk: the web is a **single npm package with Vercel auto-deploy from main** — a mobile-only commit could trigger a web deploy unless an "ignored build step" is set; converting to npm workspaces can disturb the lockfile and Vercel install; Metro (RN bundler) and npm hoisting need care |
| New repo `ffsa-hub-mobile` | Clean separation, no Vercel risk; but API and app can drift and shared types must be copied/published |
**Recommendation: same repo, `apps/mobile` as an *independent* package (own package.json and lockfile, not an npm workspace yet), with Vercel's ignored-build-step so app-only changes don't redeploy the website.** Share only a generated Supabase types file at first; extract `packages/shared` (zod schemas, permission helpers) in Phase 2 once the shape is proven. This avoids touching how the website builds. (Needs Jack's OK before any repo write.)

### C. Sign-in and permissions carry-over
- **Same Supabase Auth, same RLS.** The app signs in with `signInWithPassword` and stores the session in the OS keychain (`expo-secure-store`), possibly with an encrypted wrapper because the session JSON can exceed SecureStore's size limits (community pattern; to verify at build time).
- Calls to the existing API send `Authorization: Bearer <access token>`; **the server must be changed** (api-surface.md §1). The deactivated-user check must run on that path.
- **Biometrics = a lock on the stored session, not a new login method** (`expo-local-authentication`). Apple 2.5.13 expects LocalAuthentication.
- `GET /api/me` returns effective roles/permissions/modules so the app doesn't re-implement the menu rules (and picks up role-bundle grants the current `hasAnyPermission` misses).
- If Google sign-in (PR #293) is added later, Apple guideline 4.8 may require an equivalent "Sign in with Apple" unless the app qualifies as an enterprise/business app requiring an existing account — decide then.
**Recommendation:** exactly this; keep passwords-only for MVP; add 2FA in Phase 2 when the web PR merges.

### D. Offline
| Option | Tradeoff |
|---|---|
| Read-cache only (TanStack Query persisted to local storage) | Simple; screens open instantly and show last-known data without signal; no conflict risk |
| **Read-cache + a small "outbox" for receipt photos/expenses** | Covers the real field case (outreach, bad signal): capture now, upload later with retry; limited conflict surface |
| PowerSync / WatermelonDB (full offline DB sync) | True offline-first, but a large extra system to run/secure, conflict handling, and new moving parts on top of RLS |
**Recommendation: read-cache + receipt/expense outbox in Phase 1; revisit full sync only if field use demands it.** Rule: a queued item shows a clear "waiting to upload" state and never silently drops.

### E. Push notifications
- **Expo Push Service** wraps Apple (APNs) and Google (FCM) so one server call reaches both (Expo docs). Alternative: talk to APNs/FCM directly — more control, more code.
- Apple 4.5.4: push must not be required for the app to work and must not carry sensitive/confidential info; marketing needs opt-in. → Push says "You have 3 things waiting", not amounts or names.
- **Where triggered:** today there are none. The dashboard feed is computed on page load (`services/notifications.ts`), so I recommend a single `notify(userId, kind, key)` helper called at the existing write points (booking request/decision, staff approvals, receipts-to-match etc.), mirroring the existing stable keys (`booking:<uuid>`). Per-user prefs reuse the existing notification-preferences. Needs a `device_push_tokens` table (hand-applied migration) and a token-register endpoint.
**Recommendation: Expo push, Phase 2, with generic message text and per-category opt-outs.**

### F. Accounts and costs (verified from official pages, 1 Nov 2026)
| Item | Cost / requirement | Source |
|---|---|---|
| Apple Developer Program | **US$99 per membership year**; prices vary by region; **nonprofits, accredited educational institutions and government may request a fee waiver** | https://developer.apple.com/programs/enroll/ |
| Apple, organisation enrolment | Must be a **legal entity** (no DBAs/trade names/branches); **D-U-N-S number** (free from Dun & Bradstreet; up to 5 business days, + up to 2 days for Apple to receive); enrolling person needs legal authority to bind the organisation; work email on the org's domain; public functional website; Apple Account with 2FA | same + https://developer.apple.com/help/account/membership/D-U-N-S/ |
| Google Play | **US$25 one-time**; personal or **organisation** account; organisation requires a **D-U-N-S number**; personal accounts must complete extra app-testing and device-verification steps before publishing | https://support.google.com/googleplay/android-developer/answer/6112435 and https://support.google.com/googleplay/android-developer/answer/13634885 |
| EAS (Expo) | **Free: $0**, 15 Android + 15 iOS builds (low-priority queue, 45-min build timeout), submit to stores included, OTA to **1K monthly active users**. **Starter $19/mo** ($45 build credit, priority queue, 3K MAUs). **Production $199/mo**. Extra builds: Android $1, iOS $2 (medium worker) | https://expo.dev/pricing |
| TestFlight | free with the Apple program; builds last 90 days; up to 100 internal + 10,000 external testers; first external build gets a light review | https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ |
| Domain/hosting for deep-link files | already have www.ffsahub.com (Vercel) | — |
**Rough yearly cost to start:** about **US$99 + US$25 (once) + EAS Free or ~US$228/yr (Starter)** ≈ **US$124–352 in year one**; possibly less if Apple grants a nonprofit fee waiver. (My arithmetic from the figures above.)
**Needed from Jack:** is "Fire & Fragrance South Africa" a registered legal entity (NPC/NPO/PBO — name exactly as registered), who is the person with legal authority to be the Apple *Account Holder*, and which email/domain should own the accounts? **Do not enrol anyone personally** — that would make the app appear under a person's name and be hard to move later. (Whether FFSA qualifies for Apple's nonprofit waiver is **unverified**; Apple's page says nonprofits "meeting certain requirements" may request it.)

### G. MVP modules/screens first
Recommended first cut (maps to Phase 1): **Sign-in → Home ("needs you") → My Finance (teams, budget lines, expenses) → Receipt capture (camera, tied to a budget line) → My Events/tickets QR → Staff door check-in → Profile/notification prefs.**
"Approvals for Coreen" is **in Phase 2, not Phase 1**, because I could not find a single "finance approvals" screen on the web (the permission `finance.approve` exists; approvals appear spread across fund releases, closeouts, expenses and booking/vehicle requests). **Question for Jack/Coreen:** what exactly does she approve today and where? Her answer decides whether approvals can move into Phase 1. (Also: earlier meeting notes show names/roles around "sole approver" were uncertain — please confirm.)

### H. Design approach
Three honest options:
1. **Faithful port** of the brutalist editorial look (square, flat, Roboto Condensed 900 caps, mono labels). Consistent with web, distinctive; but light-only and some tiny 9–10 px mono labels are too small for phones.
2. **Modernised native, same identity** (recommended): keep palette (ink `#0A0A0A`, bone `#F4F2EA`, yellow `#FFB801` as the single accent), fonts (Roboto/Condensed/Mono), and the "one yellow band per screen" rule — but use platform-native behaviour (large titles, bottom sheets, haptics, smooth motion, safe areas, pull-to-refresh), a small corner radius if Jack wants it, **dark mode**, and Dynamic Type/VoiceOver support. 
3. Full refresh with a new brand — highest cost; not recommended without a brand project.
**Component library:** own thin component kit on **NativeWind** (Tailwind classes — same vocabulary the web uses) + `react-native-reanimated` + `lucide-react-native`, tokens from `design-tokens.md`. Rejected for now: Tamagui (steeper learning curve, more config), Gluestack (generic look would fight the brand). **Accessibility:** 48 px targets (matches web), min 11 pt labels, contrast checks (yellow carries black text only), reduce-motion respected, VoiceOver/TalkBack labels on camera and scan flows.
**Needs Jack's call:** option 1 vs 2, and whether a designer should produce the app icon/splash (none found in the repo).

### I. Backend changes in the web repo (all draft PRs, no deploys)
1. Middleware: accept `Authorization: Bearer`, return **JSON 401/403** (not redirect) for `/api/*`, keep the `is_active` check.
2. `createClientFromRequest(req)` helper used by routes the app needs (RLS still applies; no service-role impersonation).
3. `GET /api/me`, `GET /api/notifications`, `POST /api/devices`, `GET /api/mobile/config` (min supported version).
4. Real rate limiting (shared store) for `/api/scan/[token]` and `/api/upload/sign` (currently in-memory / unauthenticated).
5. Versioning: keep existing routes stable (the website uses them); add `X-App-Version` header and, only if breaking changes are ever needed, a `/api/v2/` namespace.
6. Deep links: host `/.well-known/apple-app-site-association` and `assetlinks.json`; point invite/recovery emails to universal links (web fallback preserved).
7. CORS: not needed for native; only for an Expo-web build (not planned).
8. Tests for each, via the existing vitest setup.

### J. Testing and release
- **EAS Build profiles:** `development` (dev client), `preview` (internal), `production`. Submit with EAS Submit.
- **Channels:** TestFlight internal → external pilot → App Store; Play **internal testing** → closed → production (staged rollout).
- **OTA policy (EAS Update):** only for JavaScript bug fixes and copy, never for new features or permission changes (Apple 2.5.2 restricts downloaded code that changes app features — cited from memory, not re-fetched; verify). Native changes always go through a full build + review. Runtime version tied to app version.
- **Automated tests:** vitest/Jest for logic, React Native Testing Library for components, **Maestro** end-to-end flows (available in EAS Workflows) for sign-in, receipt capture, check-in. Manual device matrix: ≥2 iPhones (one older), ≥3 Android (Samsung, Pixel, one low-end), tablets sanity-check.
- **App Review prerequisites:** a **demo account** and live backend during review (guideline 2.1), plus a sample QR for check-in. Use a seeded demo user with minimal permissions — never a real admin.
- Crash/perf monitoring: Sentry or Expo's own tooling — pick one (K).

### K. Other significant items
1. **Distribution model.** Public listing, or **Unlisted App Distribution** (Apple: available by direct link and through Apple Business/School Manager; suitable for limited audiences like staff/students/franchisees; the app must be submitted/ready first; anyone with the link can install, so the app still must authenticate). https://developer.apple.com/support/unlisted-app-distribution/ — **Recommendation: request Unlisted on iOS; Play "private" or normal listing on Android.** (Google's equivalent for non-public apps was not verified.)
2. **In-app payments & Apple's IAP rule.** Guideline 3.1.1 requires in-app purchase for unlocking *digital* features/content. **3.1.3(e)** says apps selling *"physical goods or services that will be consumed outside of the app"* **must** use non-IAP methods (e.g. Apple Pay or card entry). Event tickets for a physical event, and school fees for in-person training, are naturally read as services consumed outside the app, so IAP should not apply — **but the guidelines do not name "event tickets" explicitly; this is an interpretation. Apple can disagree in review.** Mitigations: describe it in Review Notes; keep Phase 1 free of any purchase flow (tickets purchased on the website; the app shows tickets); if purchase is added later use Apple Pay/Stripe card entry (PayFast is a redirect flow — open in an in-app browser). Links: https://developer.apple.com/app-store/review/guidelines/#in-app-purchase (3.1.1), #other-purchase-methods (3.1.3, esp. (e) and (d)), 3.1.5 is *Cryptocurrencies* — not relevant.
3. **Donations.** 3.2.2(iv): collecting funds for charities in-app is unacceptable unless you are an **approved nonprofit** (3.2.1(vi)). Currently no donor flow is in scope; keep it out unless Apple's nonprofit approval is obtained. (Donor-statement PDFs are fine — they are statements, not collection.)
4. **Account deletion.** 5.1.1(v): if the app supports account creation it must offer in-app deletion. Accounts appear to be invite-only (signup exposure in the app unverified); recommend an in-app "request account deletion" that opens a request to admins, and a privacy policy link in app + store.
5. **Privacy/security.** Privacy policy (5.1.1(i)), data-collection labels in both stores, South Africa POPIA review for passport photos, licences, household and insurance data (sensitive docs → Phase 3 with extra care; "apps in highly regulated fields should be submitted by a legal entity" 5.1.1(ix)).
6. **Crash/analytics vendor:** pick one; no third-party ad/analytics SDKs without consent.
7. **Tablets:** iPhone apps are expected to run on iPad (2.4.1) — plan layouts that don't break.
8. **Languages:** English only today; leave room for i18n (strings in one place) in case of Afrikaans/Zulu later.
9. **Support:** support URL/contact (1.5), release notes, screenshots (2.3.3), no real people in screenshots (2.3.9).
10. **Bundle IDs and names:** suggested `com.ffsahub.app` (unverified availability), app name ≤30 characters.

---

## 4. Risks and surprises (read these)
1. **Bearer-token change is the critical path** and touches the website's core middleware — needs careful tests and Jack's review before any deploy.
2. `/api/upload/sign` is **unauthenticated** (public applicants) and `/api/scan/[token]` has an **in-memory** rate limit that doesn't work on serverless — both existing weaknesses; fix before wider exposure.
3. Existing "signed-in only" checks on some routes (e.g. school-fees payments POST) and an unauthenticated Xero connect route (from earlier survey) mean **the API cannot be assumed safe by itself**; the app should hide sensitive modules, and the API/RLS must be re-checked for every route the app calls.
4. `hasAnyPermission` ignores role-bundle grants → someone allowed by RLS may be refused by the API (or inversely nothing worse). Fix via `/api/me` or shared helper.
5. No push exists, and the feed isn't event-sourced → push needs real design work, not a switch.
6. Receipts: if the app wrote expenses directly to Supabase the **Slack cash-alert would silently not fire** — always use the API for expenses.
7. App Store review: need demo account, live backend; "minimal functionality" is satisfied by camera/push/biometrics, but a purely admin-lookup app could be judged "repackaged website".
8. Brand tension: "extremely modern" vs brutalist light-only identity → Jack must choose (H).
9. D-U-N-S/legal-entity checks can take 1–3 weeks → start now; Apple won't accept DBAs/trade names.
10. Jack's Mac is offline right now, so no build or on-device test can happen yet; all work here was box-only, reading GitHub through the connector.

## 5. Extra questions for Jack (beyond A–K)
1. What is FFSA's exact **registered legal name/type** (and does it already have a D-U-N-S)?
2. Who will be the **Account Holder** for Apple and Google, and what email?
3. Which people are in the **pilot** (names/roles) for TestFlight/internal testing — (Apple internal testers must be App Store Connect users; external testers up to 10,000).
4. Does Coreen's "approval" mean expense approvals, fund releases, closeouts, or all three?
5. Is a designer available for the app icon, splash and store screenshots?

## 6. Unverified items (so nobody relies on them)
Apple guideline numbers 2.4.1, 2.3.3, 2.3.9, 1.5, 5.1.1(i)/(ix), 2.5.2 cited from memory (not re-fetched this session); Realtime use; exact contents of un-read migrations and roles (`finance_admin`, `comms_admin`, `mission_leader`, `schools_admin`); whether `finance.manage`/`finance.write` exist as permissions; whether `/api/auth/login-attempt` is public; SecureStore size workaround; Google's non-public distribution option; Apple nonprofit waiver eligibility; Expo SDK 58 details (from search summary of expo.dev, 1 Nov 2026).

## 7. Sources
Apple enrol https://developer.apple.com/programs/enroll/ · D-U-N-S https://developer.apple.com/help/account/membership/D-U-N-S/ · App Review Guidelines (last updated 16 Oct 2026) https://developer.apple.com/app-store/review/guidelines/ · Unlisted distribution https://developer.apple.com/support/unlisted-app-distribution/ · TestFlight https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ · Google Play registration https://support.google.com/googleplay/android-developer/answer/6112435 · Account types https://support.google.com/googleplay/android-developer/answer/13634885 · EAS pricing https://expo.dev/pricing · Expo push https://docs.expo.dev/push-notifications/overview/ · Expo New Architecture https://docs.expo.dev/guides/new-architecture/ · Supabase RN auth https://supabase.com/docs/guides/auth/quickstarts/react-native

---

## Decisions (3 Nov 2026), defaults chosen by Grok Bot under Jack's "ship everything" instruction (change any of them freely)
- **Bundle id / Android package:** `com.ffsouthafrica.hub`. Config only: nothing is registered with Apple, Google or Expo yet. Must be final before the first store build (it can never change afterwards).
- **Expo account slug:** placeholder `ffsa-hub`; no Expo/EAS account exists, no `eas.projectId`/`owner` is set.
- **Corner radius:** small, as proposed in design-tokens.md. **Dark palette:** bg `#0A0A0A`, surface `#161614`, rule `#2A2924`, text `#F4F2EA`, accent `#FFB801`.
- **Node 24** for apps/mobile (`.nvmrc`, `engines`); Node 25 is outside Expo SDK 58's supported range.
- **Phase 1 slices (parallel draft PRs):** (1) shell + Home/notifications + Me/profile + docs, (2) My Finance + receipt capture (+ offline upload queue), (3) Tickets + staff check-in. Route-folder contract: Home `app/(app)/index.tsx`, Finance `app/(app)/finance/`, Tickets `app/(app)/tickets/`, Me `app/(app)/me/`.
- **Not pre-approved:** any new database migration. Slices list migrations in their PR description; none are applied.
- **CI:** the mobile workflow lives at apps/mobile/ci/mobile-ci.yml.txt because the GitHub token lacks `workflow` scope; move it to .github/workflows/mobile-ci.yml with a token that has that scope (or via the GitHub web UI).

## Decisions (3 Nov 2026)

Recorded by the Phase 1 slice 1 PR (shell + Home + Me + docs). These are Jack's pre-approved defaults; change any of them freely. They confirm and pin down the defaults listed in the section above.

- **Bundle identifier / Android package:** `com.ffsouthafrica.hub`, set as the default in `apps/mobile/app.config.ts` (`APP_BUNDLE_ID` / `APP_ANDROID_PACKAGE` still override it). **Not registered anywhere yet** (no Apple, Google or Expo record). It can never change once an app is in a store, so confirm before the first store build. The web's `public/.well-known/assetlinks.json` and `apple-app-site-association` still hold placeholders (`com.replace_me.ffsahub`, `TEAMID`, `REPLACE_ME` fingerprint); update them when the Team ID and signing fingerprint exist.
- **Expo account:** slug placeholder `ffsa-hub`. No Expo account or organisation has been created; `owner` and `extra.eas.projectId` are deliberately absent (a TODO comment in `app.config.ts` marks where `owner` goes).
- **Corner radius: small.** `radius.default = 2` dp in `apps/mobile/src/theme/tokens.ts` (`radius.sm` 2, `radius.md` 4, `radius.none` 0). Status bands stay square (`radius.none`), like the web.
- **Dark palette:** bg `#0A0A0A`, surface `#161614`, rule `#2A2924`, text `#F4F2EA`, accent `#FFB801` (yellow keeps black text in both schemes). The app follows the phone's light/dark setting (`useTheme()`); there is no in-app override yet, so Me shows Appearance as read-only ("Follows your phone's setting").
- **Node 24** for `apps/mobile`: `apps/mobile/.nvmrc` = `24`; `engines` allows `^22.13 || ^24.3 || >=26` (Expo SDK 58's range; Node 25 is outside it).
- **Phase 1 slices (parallel draft PRs):** (1) app shell + Home/notifications + Me/profile + docs, (2) My Finance + receipt capture, (3) Tickets + staff check-in.
- **Route-folder contract:** Home `app/(app)/index.tsx` · Finance `app/(app)/finance/` · Tickets `app/(app)/tickets/` (check-in under `app/(app)/tickets/check-in/…`) · Me `app/(app)/me/`. Each slice owns its folder and its own nested `_layout.tsx`; only slice 1 edits `app/(app)/_layout.tsx`. Shared hooks: `useMe()`, `useCan(permission)` from `@/features/shell` (UX gating only; the server decides). Details in `apps/mobile/README.md`.
