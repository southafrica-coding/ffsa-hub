# FFSA Hub: phone app (`apps/mobile`)

The iOS + Android app for FFSA Hub, built with **Expo (React Native) + TypeScript + expo-router**. It signs in against the **same Supabase project** as the website (same users, same row-level security) and calls the **website's API** for anything with server-side effects.

It is an **independent app**: its own `package.json`, lockfile, `node_modules`, TypeScript, lint and tests. It is not an npm workspace, and nothing here changes how the website builds or deploys.

> **Rule: never run `npm install` at the repo root for mobile work.** Always `cd apps/mobile` first. The root `package.json` is the website.

## What's here today

- Sign-in (email + password), session restored on launch.
- **Bottom tab bar**: Home · Finance · Tickets · Me (Finance and Tickets are built by their own Phase 1 slices; until they land they show "Coming soon").
- **Home**: the "needs you" feed (`GET /api/notifications`, the same items as the web dashboard), one yellow band when something is unread, grouped list (Needs you / Earlier), mark read, pull-to-refresh, offline copy, shortcuts.
- **Me**: name, email, roles; edit name and phone; notification settings; links to the full web profile and the privacy policy; app version; sign out (this phone only).
- The design tokens and a small component kit (`Button`, `Text`, `Screen`, `TextField`, `Banner` incl. the yellow "needs you" band, `Divider`, `Masthead`).
- Final app icon and splash (Option 1, "Signature": black FF mark on `#FFB801`).

Planning docs (plan, feature inventory, API surface, permissions, design tokens, store accounts) are in [`docs/`](docs/); decisions are at the end of [`docs/plan.md`](docs/plan.md).

## App shell: route folders, `useMe`, `useCan`

**Route-folder contract.** Each tab is a folder (or file) under `app/(app)/`, owned by one slice:

| Tab | Route | Owner |
|---|---|---|
| Home | `app/(app)/index.tsx` | shell (slice 1) |
| Finance | `app/(app)/finance/` (own `_layout.tsx` + `index.tsx`) | slice 2 |
| Tickets | `app/(app)/tickets/` (own `_layout.tsx` + `index.tsx`; door check-in at `tickets/check-in/…`) | slice 3 |
| Me | `app/(app)/me/` (`_layout.tsx`, `index.tsx`, `edit.tsx`, `notifications.tsx`) | shell (slice 1) |

Only the shell edits `app/(app)/_layout.tsx` (the tab bar). The bar matches a route on its **first path segment**, so `finance` (folder with `_layout.tsx`) and `finance/index` (bare file) are the same tab, and nested routes like `tickets/check-in` keep their tab selected. Tab order, labels, icons and optional visibility rules live in `src/features/shell/tabs.ts`.

**Hooks** (`import { … } from "@/features/shell"`), usable anywhere inside the signed-in area:

| | |
|---|---|
| `useMe()` | `{ status: "loading" \| "ready" \| "error", me, error, refresh }` from `GET /api/me`, loaded once by the tab layout and refreshed when the app returns from the background (after 5 min). |
| `useCan(permission)` | `true` if the person holds that permission key (any scope, direct or via a role) or is `admin`/`super_admin`. `false` while loading. |
| `useHasRole(name)` | `true` if they hold that role (any scope). |
| `setTabBadge(tab, n)` | Puts a count on a tab (`"home" \| "finance" \| "tickets" \| "me"`); `0` hides it. Home uses it for unread notifications. |
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
  (app)/finance/         slice 2 (placeholder until it lands)
  (app)/tickets/         slice 3 (placeholder until it lands)
  (app)/me/              Me, edit profile, notification settings
docs/                    planning docs and decisions
src/
  auth/                  session provider, sign-in rules (cooldown, safe errors)
  features/shell/        tab bar, useMe/useCan, badges, shared rows, in-app browser
  features/home/         notifications API, offline cache, feed logic, strings
  features/me/           profile + notification-preference API, validation, links, strings
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

`src/theme/tokens.ts` is the single source of truth; `tailwind.config.ts` and the component kit both read it. Light follows the web; **dark is new and proposed** (system setting decides). Corner radius is one token (`radius.default`, currently 2) until Jack chooses. Touch targets are 48dp minimum, labels never go below 11, and all text follows the OS font-size setting.

Use the kit or NativeWind classes (`className="gap-4"`, `bg-surface dark:bg-surface-dark`). Tailwind's default colours and radii are removed on purpose, so off-brand classes don't exist.

### Signed-in session storage

The Supabase session is several KB. It's encrypted (AES-256-CTR plus an HMAC-SHA256 tag) with fresh random keys on every write. The keys live in the iOS Keychain / Android Keystore (`expo-secure-store`) and the ciphertext lives in AsyncStorage. A wrong key or corrupted data reads as "signed out", never a crash. Tokens are never logged.

### API contract

`apiFetch` sends `Authorization: Bearer <access token>` and `Accept: application/json`, times out after 15 s, and throws typed `ApiError`s. A `401` signs the user out and returns them to sign-in. A `403 {"error":"deactivated"}` does the same and shows "This account has been deactivated. Contact your administrator." `GET /api/me` is parsed tolerantly (unknown fields ignored, optional fields may be null or missing).

### Supabase types

The website's `src/types/database.ts` (repo root) is the source of truth. This app keeps a copy with a "GENERATED COPY" header: `npm run types:sync` refreshes it, `npm run types:check` fails if it's stale. Don't use the Supabase CLI for this.

## Placeholders and known gaps

- EAS project, Expo owner, store accounts: not set.
- **Dark mode** follows the phone's setting only; there's no in-app Light/Dark/System switch yet (Me shows Appearance as read-only).
- **Account deletion request**: the Me row is shown disabled until a request mechanism exists (Apple 5.1.1(v); Jack's decision).
- Pages opened in the in-app browser don't share the app's sign-in, so the website may ask people to sign in there once.
- Home's offline copy is per user and wiped on sign-out from Me. A forced sign-out (expired session) leaves it on the phone, keyed to that user only.
- Deep links: `scheme: ffsahub` and `applinks:www.ffsahub.com` are declared, but the app doesn't handle any links yet. "Forgot password?" opens the website in the browser.
- No push notifications (Home refreshes on open, pull-to-refresh and return from background) (the `expo-notifications` plugin and `assets/notification-icon.png` are ready for when it's added), no biometrics, no camera, no offline outbox.
- Dark mode is a first pass; the web is light-only.
- The web's tertiary grey (`#7C786C`) is 4.4:1 on white, just under WCAG AA for body text, so the app only uses it for large text and decoration.
