# FFSA Hub: phone app (`apps/mobile`)

The iOS + Android app for FFSA Hub, built with **Expo (React Native) + TypeScript + expo-router**. It signs in against the **same Supabase project** as the website (same users, same row-level security) and calls the **website's API** for anything with server-side effects.

It is an **independent app**: its own `package.json`, lockfile, `node_modules`, TypeScript, lint and tests. It is not an npm workspace, and nothing here changes how the website builds or deploys.

> **Rule: never run `npm install` at the repo root for mobile work.** Always `cd apps/mobile` first. The root `package.json` is the website.

## What's here today

- Sign-in (email + password), session restored on launch.
- **Bottom tab bar**: Home · Finance · Prayer · Tickets · Me.
- **Home**: the "needs you" feed (`GET /api/notifications`, the same items as the web dashboard), one yellow band when something is unread, grouped list (Needs you / Earlier), mark read, pull-to-refresh, offline copy, shortcuts.
- **Finance** (my finance, receipt capture, offline outbox), **Prayer** (week, set sheet, practice, my sets) and **Tickets** (my tickets, staff door check-in).
- **Bookings** (spaces, vehicles, approvals, collect/return photos) and **My Schools** (enrolments, attendance, read-only): not tabs, opened from Home's shortcuts.
- **Me**: name, email, roles; edit name and phone; notification settings; **Appearance** (Match phone / Light / Dark); links to the full web profile and the privacy policy; app version; sign out (this phone only).
- The design tokens and a small component kit (`Button`, `Text`, `Screen`, `TextField`, `Banner` incl. the yellow "needs you" band, `Divider`, `Masthead`).
- Final app icon and splash (Option 1, "Signature": black FF mark on `#FFB801`).

Planning docs (plan, feature inventory, API surface, permissions, design tokens, store accounts) are in [`docs/`](docs/); decisions are at the end of [`docs/plan.md`](docs/plan.md).

## App shell: route folders, `useMe`, `useCan`

**Route-folder contract.** Each tab is a folder (or file) under `app/(app)/`, owned by one slice:

| Tab | Route | Owner |
|---|---|---|
| Home | `app/(app)/index.tsx` | shell (slice 1) |
| Finance | `app/(app)/finance/` (own `_layout.tsx` + `index.tsx`) | slice 2 |
| Prayer | `app/(app)/prayer/` | Phase 2 prayer slice |
| Tickets | `app/(app)/tickets/` (own `_layout.tsx` + `index.tsx`; door check-in at `tickets/check-in/…`) | slice 3 |
| Me | `app/(app)/me/` (`_layout.tsx`, `index.tsx`, `edit.tsx`, `notifications.tsx`, `appearance.tsx`) | shell (slice 1) |

`app/(app)/bookings/` and `app/(app)/schools/` are hidden routes (`href: null` in the tab layout): they have their own stacks but no tab.

Only the shell edits `app/(app)/_layout.tsx` (the tab bar). The bar matches a route on its **first path segment**, so `finance` (folder with `_layout.tsx`) and `finance/index` (bare file) are the same tab, and nested routes like `tickets/check-in` keep their tab selected. Tab order, labels, icons and optional visibility rules live in `src/features/shell/tabs.ts`.

**Hooks** (`import { … } from "@/features/shell"`), usable anywhere inside the signed-in area:

| | |
|---|---|
| `useMe()` | `{ status: "loading" \| "ready" \| "error", me, error, refresh }` from `GET /api/me`, loaded once by the tab layout and refreshed when the app returns from the background (after 5 min). |
| `useCan(permission)` | `true` if the person holds that permission key (any scope, direct or via a role) or is `admin`/`super_admin`. `false` while loading. |
| `useHasRole(name)` | `true` if they hold that role (any scope). |
| `setTabBadge(tab, n)` | Puts a count on a tab (`"home" \| "finance" \| "prayer" \| "tickets" \| "me"`); `0` hides it. Home uses it for unread notifications. |
| `openWebPage(path)` | Opens a website page in the in-app browser (for things the app doesn't have yet). |

These gates are **for the interface only**. Hiding a button protects nothing: the API and Supabase RLS decide, and the app must handle a `403` gracefully (show a "not available on your account" state).

Also exported for any slice: `SectionBar` (black section header), `BarAction`, `ListRow` (56dp row, push / opens-in-browser variants), `StateMessage` (empty / no-access), `SkeletonRows` (static loading placeholder, no motion).

**Strings** live in one file per feature (`src/features/<feature>/strings.ts`) so translation can come later.

## Prerequisites

- **Node 24** (`.nvmrc`; Node 22.13+ also works) (Expo SDK 58's range: `^22.13 || ^24.3 || >=26`; Node 25 is outside it). `node -v` to check.
- A phone with **Expo Go** (App Store / Play Store), or a development build (below).
- For the API calls: a deployment of the website that includes the **bearer-token API auth** change (web PR "mobile API bearer auth": `GET /api/me`, JSON 401/403). Until that's on `www.ffsahub.com`, use a Vercel preview URL of that PR.

## Setup

```bash
cd apps/mobile
npm ci
cp .env.example .env      # then fill it in (see below)
npx expo start            # scan the QR code with your phone
```

`.env` (git-ignored) holds **public values only**:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | same as the website's `NEXT_PUBLIC_SUPABASE_URL` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same as the website's `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design) |
| `EXPO_PUBLIC_API_BASE_URL` | `https://www.ffsahub.com`, or a Vercel preview URL |

Anything `EXPO_PUBLIC_*` is baked into the app and readable by anyone who has it. **Never** put a service-role key or any other secret (Xero, Stripe, PayFast, Resend, Slack, Anthropic) here. If a value is missing or malformed the app stops at launch with a message naming the variable.

## Running on a phone

**Expo Go (quickest):** `npx expo start`, scan the QR code. Everything in the scaffold works in Expo Go.

**Development build:** needed once the app uses native modules Expo Go doesn't include (camera, push and biometrics, coming later). A development build is made with EAS (`development` profile in `eas.json`) or locally with `npx expo run:ios` / `run:android` (Xcode / Android Studio required).

## Commands

| | |
|---|---|
| `npm start` | dev server (`ios` / `android` open a simulator) |
| `npm run typecheck` | TypeScript (strict) |
| `npm run lint` | ESLint (Expo flat config) |
| `npm test` | Jest (jest-expo + React Native Testing Library) |
| `npm run types:sync` | copy the web's `src/types/database.ts` into `src/types/database.ts` |
| `npm run types:check` | fail if that copy is stale (CI runs this) |
| `npx expo-doctor` | Expo's project health check |
| `npx expo export --platform ios` | local bundle check (no EAS, no signing) |

CI (`.github/workflows/mobile-ci.yml`) runs `types:check`, `typecheck`, `lint` and `test` on changes under `apps/mobile/`.

## How builds work (EAS, run by Jack)

Store builds use **EAS** (Expo's cloud build service). `eas.json` has three profiles: `development` (dev client, internal), `preview` (internal testers) and `production` (store, auto-incrementing build numbers; versions are managed remotely by EAS).

Not done yet, deliberately:
- **No EAS project:** `eas init` (which adds `extra.eas.projectId` to the config) needs the FFSA Expo account/org first.
- **Bundle ID / package name** default to `com.ffsouthafrica.hub` (Jack's pre-approved default, 3 Nov 2026; `APP_BUNDLE_ID` / `APP_ANDROID_PACKAGE` override it). It is not registered with Apple, Google or Expo yet, and can never change after store release.
- No signing credentials, Apple IDs or store accounts are in the repo.

Website deploys are unaffected: `vercel.json` skips the website build for commits that only touch `apps/mobile/` (`scripts/vercel-ignore-mobile.sh`).

## Layout

```
app/                     routes (expo-router)
  _layout.tsx            fonts, splash, session restore, auth gate
  (auth)/sign-in.tsx     signed-out only
  (app)/_layout.tsx      signed-in only: bottom tabs + MeProvider
  (app)/index.tsx        Home ("needs you" feed)
  (app)/finance/         My Finance, receipt capture
  (app)/prayer/          Prayer Room
  (app)/tickets/         tickets, door check-in
  (app)/bookings/        bookings + hire requests (hidden route, Home shortcut)
  (app)/schools/         My Schools + attendance (hidden route, Home shortcut)
  (app)/me/              Me, edit profile, notification settings, appearance
docs/                    planning docs and decisions
src/
  auth/                  session provider, sign-in rules (cooldown, safe errors)
  features/shell/        tab bar, useMe/useCan, badges, shared rows, in-app browser
  features/home/         notifications API, offline cache, feed logic, strings
  features/me/           profile + notification-preference API, validation, links, strings
  features/appearance/   Match phone / Light / Dark choice (this device only)
  features/<slice>/      finance, prayer, tickets, bookings, schools: one folder per feature
  components/            the component kit
  lib/
    env.ts               EXPO_PUBLIC_* validation (zod)
    supabase.ts          Supabase client (session in secure storage)
    secure-storage.ts    keychain-backed encrypted session store
    api.ts               apiFetch + /api/me contract (pure, tested)
    api-client.ts        apiFetch wired to the live session
  theme/                 tokens.ts (source of truth), style mapping, fonts
  types/database.ts      GENERATED copy of the web's Supabase types
assets/                  icon, adaptive icon, splash, favicon, notification icon, ff-mark.svg (vector master)
```

### Design tokens

`src/theme/tokens.ts` is the single source of truth; `tailwind.config.ts` and the component kit both read it. Light follows the web; **dark is new** (see Appearance below). Corner radius is one token (`radius.default`, currently 2) until Jack chooses. Touch targets are 48dp minimum, labels never go below 11, and all text follows the OS font-size setting.

Use the kit or NativeWind classes (`className="gap-4"`, `bg-surface dark:bg-surface-dark`). Tailwind's default colours and radii are removed on purpose, so off-brand classes don't exist.

### Signed-in session storage

The Supabase session is several KB. It's encrypted (AES-256-CTR plus an HMAC-SHA256 tag) with fresh random keys on every write. The keys live in the iOS Keychain / Android Keystore (`expo-secure-store`) and the ciphertext lives in AsyncStorage. A wrong key or corrupted data reads as "signed out", never a crash. Tokens are never logged.

### API contract

`apiFetch` sends `Authorization: Bearer <access token>` and `Accept: application/json`, times out after 15 s, and throws typed `ApiError`s. A `401` signs the user out and returns them to sign-in. A `403 {"error":"deactivated"}` does the same and shows "This account has been deactivated. Contact your administrator." `GET /api/me` is parsed tolerantly (unknown fields ignored, optional fields may be null or missing).

### Supabase types

The website's `src/types/database.ts` (repo root) is the source of truth. This app keeps a copy with a "GENERATED COPY" header: `npm run types:sync` refreshes it, `npm run types:check` fails if it's stale. Don't use the Supabase CLI for this.

## Push notifications

Built with the **Expo push service** (one server call reaches Apple APNs and Google FCM). Push is optional: the app works the same without it.

**How it works**
- Me › Notification settings has a **"Push notifications on this phone"** switch, a status line in words, and one switch per category (stored on the server, `GET/PUT /api/devices/preferences`). The phone's own permission prompt only appears after our explanation sheet ("Turn on notifications?" / "Not now"). The sheet is also offered once on Home from the third launch, never earlier, and not again for a month after "Not now".
- With push on and allowed, the app sends its Expo push token to `POST /api/devices` (again whenever the token or the app version changes). Sign out (Me) calls `DELETE /api/devices` first, so the phone stops getting that person's notifications.
- The server pushes at two write points today: a **new booking request** (to the people who approve bookings) and a **booking decision** (to the person who asked). The text is always generic ("A new booking request is waiting for you"): never names, amounts or details (Apple 4.5.4).
- Tapping a notification opens the matching app screen (same table as Home's feed), or the website page in the in-app browser. The app icon badge shows Home's unread count.
- Android has one notification channel per category (`booking_requests`, `booking_updates`).
- Code: `src/features/push/` (app), `src/lib/push/` + `src/app/api/devices/` (server, repo root).

**What the status line means**
| Status | Why |
|---|---|
| Notifications are not switched on for this build yet | No Expo project id in this build, a simulator, or Expo Go (push needs a development or store build). |
| Notifications are not switched on for FFSA Hub yet | The server answered `503 push_not_enabled`: migration 288 isn't applied. The app asks again next launch, not before. |
| Off in your phone's Settings | The person said no to the system prompt. "Open Settings" takes them there. |

**Needs Jack** (nothing here can be done by an agent):
1. **Apply the migration** `supabase/migrations/288_device_push_tokens.sql` in the Supabase SQL Editor. Until then the server answers `503 push_not_enabled` and sends nothing.
2. **Create the Expo project** under the FFSA Expo org (`eas init` in `apps/mobile`, or on expo.dev), then set its id as `EXPO_PUBLIC_EAS_PROJECT_ID` (in `.env` for local builds and in the EAS build environment). `app.config.ts` copies it to `extra.eas.projectId`. It's a public id, not a secret, but keep it out of git like the other values.
3. **iOS:** in EAS credentials, let EAS create (or upload) an **APNs key** for the bundle id `com.ffsouthafrica.hub` (Apple Developer account needed).
4. **Android:** create a Firebase project for the package `com.ffsouthafrica.hub`, upload its **FCM V1 service-account key** to EAS credentials, and add the `google-services.json` path to `app.config.ts` (`android.googleServicesFile`).
5. Optional: switch on "enhanced push security" for the Expo project and put the access token in the **website's** Vercel env as `EXPO_ACCESS_TOKEN` (server only; never in the app).
6. Make a development or preview build (EAS) and check push on real phones (Expo Go can't receive remote pushes).

## Placeholders and known gaps

- EAS project, Expo owner, store accounts: not set.
- **Dark mode**: Me › Appearance offers *Match phone* (the default), *Light* or *Dark*. The choice is stored on this device only (not synced to your account, kept on sign-out). Audit and device checks: [`docs/dark-mode.md`](docs/dark-mode.md).
- **Account deletion request**: the Me row is shown disabled until a request mechanism exists (Apple 5.1.1(v); Jack's decision).
- Pages opened in the in-app browser don't share the app's sign-in, so the website may ask people to sign in there once.
- Home's offline copy is per user and wiped on sign-out from Me. A forced sign-out (expired session) leaves it on the phone, keyed to that user only.
- Deep links: `scheme: ffsahub` and `applinks:www.ffsahub.com` are declared, but the app doesn't handle any links yet. "Forgot password?" opens the website in the browser.
- Push notifications are built (see "Push notifications" above) but stay off until Jack does the setup marked **needs Jack**. No biometrics yet.
- The web is light-only, so pages opened in the in-app browser stay light in dark mode.
- The web's tertiary grey (`#7C786C`) is 4.4:1 on white, just under WCAG AA for body text, so the app only uses it for large text and decoration.
