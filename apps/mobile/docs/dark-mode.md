# Dark mode: audit, fixes and follow-ups

Phase 2, batch 2 (branch `feat/mobile-p2-dark`), 3 Nov 2026. This was done by reading the code
and with unit tests. **No phone or simulator was available**, so every row marked "fixed" still
needs a look on a real device (see the checklist at the end).

## How dark mode works now

- **One mechanism.** The Appearance choice (Me > Appearance: *Match phone* (default) / *Light* /
  *Dark*) is applied with NativeWind's `colorScheme.set()`, which calls React Native's
  `Appearance.setColorScheme()`. That one override drives `useColorScheme()` and so `useTheme()`
  (return shape unchanged: `{ scheme, colors }`), NativeWind's `dark:` variants (`darkMode`
  stays `"media"`, which follows the same override on native), and native UI that follows the
  window style: alerts, the iOS date picker, the keyboard and the in-app browser chrome.
- **Stored on this phone only**, in AsyncStorage under `ffsa:appearance:v1` (values `system`,
  `light`, `dark`; anything else reads as `system`). No server, no migration. It is not
  personal data, so **sign-out does not clear it** (sign-out only clears the `ffsa:home-feed:*`
  keys).
- **No flash.** `AppearanceProvider` (root, `app/_layout.tsx`) reads the choice and applies it
  before the splash screen hides (the splash already waits for fonts and the session). The
  splash itself is brand yellow in both schemes, on purpose.
- The root also sets the **React Navigation theme** from the tokens (`src/theme/navigation.ts`),
  so every navigator's scene/card/header background is the token background, and the **native
  root view background** (`expo-system-ui`) to `colors.bg`, so keyboard, rotation and screen
  transitions never show white behind a dark screen. The status bar follows the scheme.

## Redesign (R1 foundation, 18 Nov 2026)

The iPhone redesign changed the light scheme and one dark value (design-spec §2, full list in
`docs/redesign-kit.md`): dark `textTertiary` is now `#C7C3B5` (same as secondary, 11.2:1), and
two dark-specific roles were added: primary buttons and switches "on" are **yellow with black**
(`primary` / `onPrimary`), and a focused text field draws a **yellow** 2px ring (`focus`). Sheets
and fields use `raised` (the dark surface `#161614`); the selected segment uses `segmentOn`
(`#2A2924`); the sheet scrim is darker in dark (66% black). `bone` `#C5C2AE` is text on black
only. Every other dark token below is unchanged.

## Palette changes (dark only, batch 2)

| Token | Was | Now | Why |
|---|---|---|---|
| `ruleStrong` | `#45423B` (1.98:1 on bg) | `#6B675D` (3.51:1 on bg, 3.21:1 on surface) | Input and switch-track outlines vanished on near-black. WCAG 1.4.11 asks for 3:1. |
| `textQuiet` | `#7C786C` (4.49:1 on bg) | `#858175` (5.09:1 bg, 4.65:1 surface) | Placeholders were just under 4.5:1. Still dimmer than tertiary. |
| `danger` | `#E05A5A` (4.01:1 on surfaceStrong) | `#EB7070` (6.68 bg, 6.11 surface, 4.92 surfaceStrong) | Error text on pressed/strong fills was under 4.5:1. |

`src/theme/__tests__/tokens.test.ts` now checks every dark body-text tone against bg, surface and
surfaceStrong (4.5:1), ink on the yellow band (and that light text on yellow would fail),
ruleStrong at 3:1, the text hierarchy order, and the control helpers below. The dark status
colours (positive, attention, danger) still need a design review, as before.

## Audit

Status: **fixed** (in this branch) · **ok** (already honours the theme, checked) ·
**kept** (fixed colour on purpose) · **follow-up** (not fixed here; reason given).

| Screen / area | Problem found | Fix | Status |
|---|---|---|---|
| Whole app | No way to choose light or dark; Me showed a read-only line. | Appearance screen + `AppearanceProvider`, applied app-wide (above). | fixed |
| Whole app | Native root view background came from `app.config.ts` `backgroundColor` (brand yellow), so yellow/white could show behind screens during transitions and the keyboard in dark mode. | `SystemUI.setBackgroundColorAsync(colors.bg)` at the root, re-run when the scheme changes. `app.config.ts` untouched (shared file). | fixed |
| Whole app | Navigators used React Navigation's default (white) theme underneath the screens. | `ThemeProvider` with `navigationTheme()` built from tokens. | fixed |
| Splash | Brand yellow in both schemes. | None needed: it's the brand splash, black mark on yellow. | kept |
| Status bar | Already followed the scheme; now follows the in-app choice too (same override). | — | ok |
| Android navigation bar | Edge-to-edge (SDK 58): the bar is transparent over our bg; button colour comes from the DayNight theme, which the Appearance override switches. | None in code. Needs a device check; if the buttons are wrong, add `expo-navigation-bar` and set its style from the scheme. | follow-up (device) |
| Sign-in | Wordmark already swaps black/white PNGs by scheme; tick uses accent. | — | ok |
| Kit: `TextField` | Outline (`ruleStrong`) 1.98:1 in dark; placeholder 4.49:1. | Dark token values above. | fixed |
| Kit: `Button`, `Banner`, `LargeTitle`/`Masthead`, `Text`, `Divider`, `Screen` and the redesign kit | All colours from tokens; the yellow band is yellow with ink text in both schemes (no border since the redesign); primary buttons are yellow/black in dark; every kit component is snapshotted in light and dark (`src/components/__tests__/gallery.test.tsx`). | — | ok |
| Kit: `Button` loading spinner | `ActivityIndicator` uses the button's text colour. | — | ok |
| Shell: `TabBar` | Tint, pressed fill, yellow active tick and badge (inverse) all from tokens; tick is decoration, the selected state is also in the role/label. | — | ok |
| Shell: `SectionBar`, `ListRow`, `StateMessage`, `SkeletonRows` | Tokens. In dark the black section bar inverts to bone with ink text (13:1+), so it still reads as a bar on a black page. | — | ok |
| Shell: in-app browser (`openWebPage`) | Toolbar/controls colours come from the `colors` the caller passes. Bookings passed none, so the browser opened light in dark mode. | Bookings' six calls now pass `colors`. | fixed |
| Home: feed, `NotificationRow` | Tokens. | — | ok |
| Home: pull-to-refresh (`app/(app)/index.tsx`) | Android spinner disc defaults to white; with a light arrow in dark it is low contrast. | Batch 3 follow-ups: spreads `refreshControlColors(colors)` onto its `RefreshControl` (My Schools list, enrolment and attendance too). | fixed |
| Finance: Home, Team (two lists) pull-to-refresh | Same white Android disc. | `refreshControlColors()` (tint, arrow, disc = surface). | fixed |
| Finance: expense "rate confirmed" switch | Dark thumb was `colors.bg` (near-black) on a near-black page when off. | `switchColors()`: dark thumb is light grey off, ink on the bone track on. Light unchanged. | fixed |
| Finance: bottom `Sheet`, skeleton pulse | Scrim is ink 45% in both schemes (invisible on black, by design); the sheet has a 2px `text` top rule, so it still stands apart in dark. Pulse stops under reduce-motion. | — | ok |
| Finance: receipt camera, zoomable photo, outbox thumbnails | Photo surfaces use `surface`; thumbnails mark `accessibilityIgnoresInvertColors`. | — | ok |
| Tickets: list pull-to-refresh | White Android disc. | `refreshControlColors()`. | fixed |
| Tickets: ticket QR | Must stay dark-on-light with a quiet zone or scanners fail. Already a white card with an ink border, ink modules, `quietZone` 8 + 16 padding, in both schemes. | — | kept |
| Tickets: door scanner | Camera overlay is fixed ink/white (always over a live camera picture). | — | kept |
| Tickets: verdict card, guest search spinner | Tokens; accent verdict uses ink text/border on yellow. | — | ok |
| Prayer: week / day / set sheet / practice / my sets | Tokens; curated band chip inverts in dark (comment in code); dashed "needs a lead" border uses text colour. | — | ok |
| Prayer: pull-to-refresh | White Android disc. | `refreshControlColors()`. | fixed |
| Prayer: bottom sheet | Same as finance's sheet. | — | ok |
| Bookings: home, approvals, space and vehicle detail pull-to-refresh | White Android disc. | `refreshControlColors()`. | fixed |
| Bookings: date/time picker | iOS picker gets `themeVariant={scheme}` + `accentColor`; Android's dialog follows the DayNight theme (switched by the override). | — | ok (device check) |
| Bookings: vehicle photos, conflict list | Tokens. | — | ok |
| Me: profile, edit | Tokens. Header colours come from `me/_layout.tsx` (tokens). | — | ok |
| Me: Appearance row | Was a read-only line. | Pressable `ListRow` opening `/me/appearance`, subtitle shows the current choice. | fixed |
| Me: notification settings switches (`app/(app)/me/notifications.tsx`) | Same dark-thumb problem as the expense switch. | Batch 3 follow-ups: spreads `switchColors(colors, scheme, on)` onto each `Switch`. | fixed |
| Alerts, action sheets, keyboard | System UI; follows the window style the override sets (iOS) / DayNight (Android). | — | ok (device check) |

## Reduce motion and Dynamic Type (spot check, by reading the code)

Reduce motion: both bottom sheets skip the slide, the finance skeleton stops pulsing, shell
skeletons never move, no `LayoutAnimation` anywhere. The appearance screen has no motion; its
haptic is a single selection tick. Nothing to fix.

Dynamic Type (largest sizes): text has no fixed heights, labels never go below 11, display type is
capped (`maxFontScale`) and the tab labels shrink to fit. Not fixed here (files outside this
slice, or a layout change rather than a colour fix), listed for their owners:

- Prayer: time labels in the practice view, practice sheet and set sheet sit in fixed 104dp
  columns (`PracticeView.tsx`, `PracticeSheet.tsx`, `SetSheet.tsx`); "08:00–09:30" will wrap at
  the largest sizes. Use `minWidth` or let the column grow.
- Tickets: the date box in `TicketRow.tsx` is a fixed 48dp wide; a large day/month may clip.
- Finance: the receipt thumbnail column in `ExpenseScreen.tsx` is 96dp wide with a caption under
  it; check the caption at the largest size.

## Device checklist (not done: no device)

1. iPhone and Android, phone set to light, app on *Match phone*: switch the phone to dark in
   Control Centre / Quick Settings while the app is open; every tab should follow.
2. Me > Appearance > Dark while the phone is light (and the reverse): the whole app, status bar,
   Android navigation bar buttons, keyboard, alerts and the bookings date picker should switch
   at once.
3. Force-quit and reopen with *Dark* chosen and the phone light: no light flash after the splash.
4. Sign out and back in: the choice is still there.
5. Tickets in dark: open a ticket, scan its QR with another phone's camera and with the door
   scanner.
6. Pull to refresh on Home, Finance, Tickets, Prayer, Bookings and My Schools in dark (Android: the spinner disc
   should be dark grey, not white).
7. Expense form "rate confirmed" switch and Me › Notification settings switches in dark, on and off (Android especially).
8. Largest text size (iOS Larger Accessibility Sizes, Android font size max + display size max):
   Appearance screen rows, Me rows, and the follow-ups above.
9. VoiceOver / TalkBack on the Appearance screen: it should read "Appearance, radio group",
   then each option with "selected / not selected" (or "checked") and the hint.
