# Face ID lock (R5-1, frame 1.6)

An optional lock on this phone. **Off by default.** People turn it on in
**Me › Settings › Lock with Face ID** (the row says Touch ID / Fingerprint /
Face unlock / Iris unlock, whatever the phone reports). The row only shows
when the phone has the hardware **and** something enrolled, or when the lock
is already on (so it can always be switched off).

## Rules

- Turning it **on** asks for Face ID once. A cancel or failure leaves it off.
  Turning it off asks nothing.
- When on, the app **locks on a cold start** and when it comes back after
  **5 minutes or more in the background** (`LOCK_AFTER_MS`). Sooner doesn't
  lock. A Face ID prompt or Control Centre only makes the app "inactive",
  which never counts as time away.
- Fallback is the **phone's own passcode** (`disableDeviceFallback: false`).
  The app never has a PIN of its own. No 2FA, no server change.
- The choice is stored **on this phone only** (AsyncStorage `ffsa:lock:v1`)
  and **forgotten on sign-out**, however that happens (Me › Sign out, the
  lock screen, a deactivated account, a 401).
- The lock screen covers everything (no tab bar), hides what's underneath
  from screen readers, asks for Face ID **once** as it appears, and after a
  cancel waits for **Unlock**. **Sign out instead** runs
  `features/me/sign-out.ts`, the same cleanup as Me › Sign out.
- While the app is in the background with the lock on, a plain cover (the
  mark) replaces the content, so the app switcher snapshot shows nothing.
- The volunteer door (`/scan/<token>`) is outside the signed-in area and is
  never locked: its link is the credential, not a Hub session.

## Files

- `logic.ts`: the pure rules (lock reducer, 5-minute timing, what to call the
  biometrics, what an unlock answer means). Tested on their own.
- `biometrics.ts`: the only file that calls `expo-local-authentication`.
- `storage.ts`: the saved choice.
- `LockProvider.tsx`: at the root (`app/_layout.tsx`, inside SessionProvider).
  Reads the choice before the splash hides, follows AppState, forgets the
  choice on sign-out.
- `LockGate.tsx`: wraps the signed-in area (`app/(app)/_layout.tsx`) and draws
  the lock screen or the cover over it. Screens stay mounted underneath, so
  unlocking returns you to where you were.
- `LockScreen.tsx` (+ `PrivacyCover`), `FfMark.tsx` (the FF mark on the
  yellow tile), `LockSettingRow.tsx`, `strings.ts`.

## Tests

`jest.setup.ts` mocks `expo-local-authentication` as a phone with no
biometrics, so nothing else in the app sees the row or the lock. The lock
tests set hardware, enrolment, types and `authenticateAsync` per test.
Wiring through the real layouts: `app/__tests__/lock-gate.test.tsx`.

Works in **Expo Go on iOS** (Face ID permission is built into Expo Go). A
development or store build gets `NSFaceIDUsageDescription` from the
`expo-local-authentication` plugin in `app.config.ts`.
