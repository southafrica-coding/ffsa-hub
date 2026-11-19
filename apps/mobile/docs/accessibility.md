# Accessibility: audit, fixes and follow-ups

Phase 2, batch 3 (branch `feat/mobile-p2-a11y`), 3 Nov 2026. Done by reading the code against the
bar in plan decision H, with unit and component tests. **No phone or simulator was available**:
every "Fixed" and "Pass" below is from code and tests, not from VoiceOver or TalkBack on a device.
The device checklist at the end is what still needs a person with a phone.

Status: **Pass** (already right, checked) · **Fixed** (changed in this branch) ·
**Follow-up** (not fixed here; the reason is given) · **n/a** (nothing of that kind on the screen).

## The bar (plan decision H)

- Every interactive element has a role, a name (label or visible text) and its state
  (selected, checked, disabled, busy, expanded). Hints only where the result isn't obvious.
- Headings are marked as headers so screen-reader users can jump between sections.
- Touch targets are at least **48 x 48 dp** (minHeight/minWidth, or hitSlop when the drawing must
  stay small).
- Text follows the phone's text size. Checked at **fontScale 2.0**: no fixed heights on text, no
  fixed-width columns that clip; only the huge display type is capped (`maxFontScale`).
- Contrast, computed from the tokens in **both light and dark**: 4.5:1 for body text, 3:1 for
  large text and for UI parts that carry meaning (outlines, icons, switch tracks). Yellow carries
  black text only.
- Status is never colour alone: there is always a word or an icon too.
- Reading order matches what you see; decorative icons and ticks are hidden from screen readers.
- Focus lands somewhere sensible after navigation, sheets and errors; async results (saved, sent,
  scan verdicts, errors) are announced.
- Reduce motion is respected.

## Shared pieces added in this branch

| Piece | Where | What it does |
|---|---|---|
| `contrastRatio`, `meetsAA`, `luminance`, `formatRatio` | `src/lib/a11y/contrast.ts` | WCAG 2.x maths, pure. The contrast tests and this audit use it. |
| `announce()`, `announcement()` | `src/lib/a11y/announce.ts` | Speaks a short result through VoiceOver / TalkBack. On iOS it queues behind what VoiceOver is already saying, so a focus move after navigation doesn't cut it off. Empty messages are ignored. |
| `useReduceMotion()`, `useScreenReader()` | `src/lib/a11y/settings.ts` | One copy of the reduce-motion hook (finance and prayer each had their own) and a screen-reader hook (only for keeping things on screen longer, never for hiding content). |
| `hitSlopFor()`, `minTarget`, `effectiveTarget()` | `src/lib/a11y/target.ts` | Pads small controls out to 48 dp. |
| `auditTappables()`, `tappableSizes()` | `src/lib/a11y/testing.ts` | **Test only.** Walks a rendered screen and lists every tappable without a role or without a name. Each feature's `a11y.test.tsx` asserts it returns `[]` in the screen's main states. |

## Colour contrast (both themes, from the tokens)

`src/theme/__tests__/contrast.test.ts` checks every text/background and UI-part/background pair the
app paints, in light and dark. Ratios (rounded down):

Updated for the iPhone redesign tokens (R1 foundation, 18 Nov 2026, `docs/redesign-kit.md`).

| Pair | Light | Dark | Needs |
|---|---|---|---|
| text on bg | 19.80 | 17.66 | 4.5 |
| text on surface (list groups, banners; light surface is now `#FBFAF7`) | 18.97 | 16.17 | 4.5 |
| text on surfaceStrong (pressed fills) | 15.55 | 13.00 | 4.5 |
| textSecondary on bg / surface | 7.80 / 7.47 | 11.22 / 10.27 | 4.5 |
| textSecondary on surfaceStrong | 6.13 | 8.26 | 4.5 |
| textTertiary on bg / surface (now body-size safe) | 5.64 / 5.40 | 11.22 / 10.27 | 4.5 |
| textQuiet (placeholders) on bg | 5.64 | 5.09 | 4.5 |
| danger on bg / surface | 4.83 / 4.63 | 6.68 / 6.11 | 4.5 |
| positiveText on bg / surface | 4.91 / 4.71 | 9.93 / 9.09 | 4.5 |
| attention on bg / surface | 5.38 / 5.15 | 8.82 / 8.07 | 4.5 |
| ink on the yellow band | 11.42 | 11.42 | 4.5 |
| onPrimary on primary (ink/white light, black/yellow dark) | 19.80 | 11.42 | 4.5 |
| onInverse on inverse (ink chips, badges, section bars) | 19.80 | 17.66 | 4.5 |
| onPositive on positive (green verdict) / onDanger on danger (danger fill) | 4.91 / 4.83 | 7.79 / 6.68 | 4.5 |
| ruleStrong on bg (field, chip, radio outlines; switch track off) | 3.46 | 3.51 | 3 |
| ruleStrong on surface | 3.31 | 3.21 | 3 |
| focus ring on a field (blue light, yellow dark) | 9.59 | 10.45 | 3 |
| danger / positive / attentionBorder rules on bg | 4.83 / 4.91 / 3.24 | 6.68 / 7.79 / 6.10 | 3 |
| textSecondary icons (inactive tabs) on bg | 7.80 | 11.22 | 3 |
| bone (`#C5C2AE`) on ink: scanner captions only | 11.03 | 11.03 | 4.5 |

Exempt by WCAG and listed in the test so the exemption is explicit: hairline `rule` separators
(decoration), the yellow title and tab ticks and the selected segment's yellow underline
(decoration; the state is also bold text and the selected role).

### Light-scheme outline and placeholder: resolved by the redesign

The two light-mode failures held for Jack on 3 Nov (`ruleStrong` #C7C3B5 at 1.76:1, `textQuiet`
#9A9689 at 2.95:1) are closed by the redesign's decided values (design-spec §2): `ruleStrong`
`#8E8A7C` (3.46:1 on white) and `textQuiet` `#6B675D` (5.64:1). `contrast.test.ts` no longer
carries any known gaps.

## Component kit and shell (fixed once, every screen benefits)

| Component | Check | Status | Notes |
|---|---|---|---|
| `Text` | Headers | Pass | display and title variants get the header role. |
| `Text` | Dynamic Type | Pass | `allowFontScaling` on all text; only display sizes are capped (pageTitle/display 1.4x, hero 1.3x, kpi 1.6x, title 1.6x, monoLabel 2x); body, captions, labels and row titles are uncapped. Nothing under 11. |
| `Button` | Role, name, state | Pass | button role, label, disabled + busy state. |
| `Button` | Touch target | Pass | minHeight 50 (44 for size="small" and text buttons) + hitSlop 4. |
| `Button` | Decorative icons | Fixed | Icon and loading spinner were read out as extra elements; now hidden (the busy state says it). |
| `TextField` | Name | Fixed | The visible label was a separate stop before the input, so VoiceOver read the label twice. The visual label is now hidden; the input carries it (`accessibilityLabel` + `accessibilityLabelledBy`). |
| `TextField` | Errors | Pass | The error is the input's hint and an alert live region (announced as it appears). |
| `TextField` | Show/hide password | Fixed | Already labelled; eye icon now hidden, hint added. 48 x 48. |
| `TextField` | Outline and placeholder contrast | Fixed | Redesign token values above. |
| `Banner` | Role | Pass | danger = alert (assertive), others summary (polite); read as one unit. |
| `Banner` | With an action (e.g. Try again) | Fixed | The whole band became non-accessible so the button stayed reachable, which also dropped the alert role and live region: the error was neither findable as an alert nor announced. The message is now its own alert/live-region element beside the button. |
| `Banner` | Announced on iOS | Fixed | VoiceOver ignores live regions, so danger banners were silent on iPhone. They now `announce()` title + message on iOS when they appear or change (string content). Features that announced their own errors were changed so nothing is spoken twice. |
| `Masthead` | Decorative | Fixed | The yellow tick was a focusable empty view; now hidden. The title is a header. |
| `Divider` | Decorative | Pass | Hidden. |
| `Screen` | Reading order | Pass | Safe area, scroll view, keyboard avoiding; one yellow band enforced in dev. |
| Shell `TabBar` | Role, state | Pass | tablist / tab, selected state, "Tab n of m" hint, unread count in the name. |
| Shell `TabBar` | Decorative | Fixed | Active tick and icons are now hidden (the badge already was). |
| Shell `TabBar` | Dynamic Type | Pass | Labels capped at 1.6x and shrink to fit on five tabs. |
| Shell `ListRow` | Name | Fixed | A caller's custom hint replaced the subtitle, so the subtitle (e.g. the current Appearance choice) was never read. The hint now keeps the subtitle first. Icons and chevrons hidden. |
| Shell `ListRow` | Web rows | Pass | link role, "Opens in browser" in the name. |
| Shell `StateMessage` | Decorative | Fixed | Icon box was hidden on Android only; now hidden on iOS too. Title is a header. |
| Shell `SkeletonRows` | Loading | Pass | One labelled progressbar; no motion. |
| Shell `SectionBar` / `BarAction` | Header, target | Pass | header role; action 40 + hitSlop 4 = 48. |


## Screens

Each area was audited screen by screen. Shared finance building blocks (`Row`, `Chips`, `ErrorState`, `Skeleton`, `Tag`) are also used by Schools and Bookings and are covered under Finance.

## Home and Finance

### Home (`app/(app)/index.tsx`, `src/features/home/NotificationRow.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Rows are `button`/`link` with one label: "Unread. Title. Body. 2h ago. Opens in browser". Band's Open says which item ("Open: …"); Mark all read says how many. Shortcuts are kit `ListRow`s (subtitle in hint). |
| Headers | Pass | Masthead greeting, section bars (Needs you (n) / Earlier / Shortcuts), empty and no-access titles. |
| Touch targets | Pass | Rows 64dp min; BarAction 40dp + 4dp slop; ListRow 56dp. |
| Dynamic Type (2.0) | Pass | No fixed text heights; body caption capped at 3 lines visually but the full body is in the row's label. |
| Contrast | Pass | Tokens only (refresh colours are the follow-ups slice's line). |
| Status not colour alone | Pass | Unread = bold title + filled icon box + the word "Unread" in the label. |
| Reading order | Pass | Masthead → offline/stale notice → band → list → shortcuts. |
| Focus | Pass | No sheets; navigation hands focus to the next screen's header. |
| Announcements / live regions | Pass | Danger/offline banners are kit live regions. |
| Reduce motion | n/a | Nothing animates. |
| Images / camera | n/a | — |
| Decorative icons | Fixed | Notification kind icon box was `importantForAccessibility="no"` only; now also hidden on iOS. |

### My Finance (`src/features/finance/screens/HomeScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Team rows: one button with name, status, programme, money in words, pending items, plus a hint. |
| Headers | Pass | Masthead; section bar is a header with its count ("Your teams, 1 team"). |
| Touch targets | Pass | Rows 48dp min. |
| Dynamic Type (2.0) | Follow-up | Team name is `title` (capped 1.6×) clamped to 2 lines; very long names truncate visually (full name is in the label). Consider 3 lines. |
| Contrast | Pass | Tokens only. |
| Status not colour alone | Pass | Status is a bordered word (`Tag`); "saved on this phone, not yet sent" in words. |
| Reading order | Pass | — |
| Focus | Pass | — |
| Announcements / live regions | Pass | Error banner (danger) and offline banner are live regions. |
| Reduce motion | Fixed | Skeleton pulse now uses the shared `useReduceMotion` (`@/lib/a11y`), re-exported from `components/ui.tsx`. |
| Images / camera | n/a | — |
| Decorative icons | Pass | Compact budget bar inside rows is hidden (row label says the figures). |

### Team (`src/features/finance/screens/TeamScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Big number read "Left: -R…" when over budget; now "Over budget: R…". Budget bar is a `progressbar` with value. Filter chips are radios with checked state; filter label moved to strings. |
| Headers | Fixed | Chip group label ("Show") is now a header so iOS reads the group's name (iOS doesn't speak a radiogroup label). |
| Touch targets | Pass | Rows and chips 48dp. |
| Dynamic Type (2.0) | Pass | — |
| Contrast | Pass | Tokens only. |
| Status not colour alone | Pass | Receipt state is words + icon; estimate/Slack are `Tag`s. |
| Reading order | Pass | — |
| Focus | Pass | — |
| Announcements / live regions | Fixed | "Expense saved / saved on this phone" flash now goes through `announce()` (queued behind VoiceOver's focus change after `router.back()`). |
| Reduce motion | Pass | Skeleton still under reduce-motion. |
| Images / camera | n/a | — |
| Decorative icons | Pass | Icons sit inside rows that are one labelled element. |

### Add / edit expense (`src/features/finance/screens/ExpenseScreen.tsx`, `components/Sheet.tsx`, `components/ui.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Budget-line picker: visible "Budget line" label hidden (the button already says "Budget line: Food"), its error now in the hint. Today / Yesterday / More details got hints; More details keeps `expanded`. Receipt thumbnails are `imagebutton`s and now report `disabled` when there's no image yet. "Loading receipts" moved to strings. |
| Headers | Pass | Masthead, "Receipts" title, sheet title. |
| Touch targets | Pass | Fields, chips, picker, sheet rows 48dp; thumbs 96dp. |
| Dynamic Type (2.0) | Fixed | Thumb column was a fixed 96dp, squeezing the Remove button label at large sizes; now `minWidth 96 / maxWidth 160`. |
| Contrast | Pass | Tokens only; outline (`ruleStrong`) and placeholder (`textQuiet`) fixed at token level by the kit commit. |
| Status not colour alone | Pass | Errors are text + 2px outline; selected sheet row has a check mark + bold + left rule. |
| Reading order | Fixed | "Rate confirmed" switch: the visible words beside it are hidden so the switch (with its own label and hint) is one stop. |
| Focus | Pass | Sheet is a Modal with `accessibilityViewIsModal`; Close button + labelled scrim; back gesture closes. |
| Announcements / live regions | Fixed | First validation error announced via `announce()` (was a raw `announceForAccessibility`, which VoiceOver can drop); field errors are `alert`s; "Not saved" banner is a danger live region. |
| Reduce motion | Pass | Sheet skips the slide when reduce motion is on. |
| Images / camera | Pass | Thumbs "View receipt n" + hint; take/choose photo buttons have hints; images ignore invert colours. |
| Decorative icons | Pass | Camera/library icons hidden by the kit `Button`. |

### Receipt viewer (`src/features/finance/screens/ReceiptViewerScreen.tsx`, `components/ZoomableImage.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Image `image` role with "Receipt: file" label + hint; Zoom in / Zoom out buttons for anyone who can't pinch. |
| Headers | Fixed | The title line is now a header (and wraps to 2 lines instead of 1). |
| Touch targets | Pass | Kit buttons. |
| Dynamic Type (2.0) | Fixed | Title no longer cut to one line. |
| Contrast | Pass | — |
| Status not colour alone | n/a | — |
| Reading order | Pass | Title → Close → image → zoom buttons. |
| Focus | Pass | Full-screen modal. |
| Announcements / live regions | Pass | Load failure is an `alert`. |
| Reduce motion | Pass | Zoom is instant under reduce motion (reanimated `useReducedMotion`). |
| Images / camera | Pass | — |
| Decorative icons | n/a | — |

### Finance stack (`app/(app)/finance/_layout.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Native back button labelled "Back". |
| Others | n/a | Headers are blank on purpose; each screen's masthead is the heading. |

**Follow-ups**
- `OutboxList.tsx` (outbox slice): "Saved, not sent" box title should be a header; status changes (waiting → sending → failed) aren't announced (add a live region on the status or `announce()` on fail/sent); the receipt thumbnail is inside the labelled row (ok). Retry/Remove buttons are already named per item.
- `src/features/finance/outbox/**`: no UI; nothing to fix. When an item finally sends in the background, nothing tells a screen-reader user — consider an announcement from the provider.
- My Finance team names clamp at 2 lines (see above).
- Hard-coded English left in TeamScreen / OutboxList strings ("item(s) couldn't be sent…", "Figures in rand…", "Receipt photo"): not a11y, move to strings.ts when i18n starts.

**Device checks**
- VoiceOver: add an expense with nothing filled in, tap Save → hear the first error; then the picker's hint includes the error.
- VoiceOver/TalkBack: save an expense, land on Team → hear "Expense saved…" after the back transition.
- Team over budget: big number reads "Over budget: R…".
- Expense form at the largest text size: thumbs + Remove button, Today/Yesterday buttons, amount/currency row.
- Receipt viewer with Switch Control / Voice Control: Zoom in / out buttons work.

## Tickets and door check-in

Tests: `src/features/tickets/__tests__/a11y.test.tsx` (17 tests: roles, names, headers, states, `auditTappables` on loading / empty / error / success / permission-denied, scanner states).

### My tickets (`app/(app)/tickets/index.tsx` → `MyTicketsScreen`, `TicketRow`, `ListHeader`, the kit's `ListGroup` / `EmptyState` / `SkeletonList`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Rows are buttons whose label reads title, time, place, holder, status; hint "Opens the ticket…". Past toggle has `expanded` state. Registration rows (not tappable) are one grouped text. |
| Headers | Fixed | Masthead and section bars were already headers. The empty state was grouped, so its title lost the header role. It's no longer grouped. |
| Touch targets | Pass | Rows have minHeight 56 and are full width. Kit buttons are 50 (44 small). |
| Dynamic Type (2.0) | Fixed | The date box was a fixed `width: 48` and would clip at large sizes. Now `minWidth: 48`. Redesign: nothing clamps any more, titles and places wrap and the row grows. |
| Contrast | Pass | Tokens only. |
| Status not colour alone | Pass | `StatusTag` is the kit `StatusChip`: an icon and words (Ready to scan / Checked in / Cancelled / Confirmed / Pending / Waitlisted). |
| Reading order | Pass | Title → check-in button → banners → list → Get tickets (a `link`, "Opens in browser"). |
| Focus | Pass | Native stack push. The screen reader starts at the header. |
| Announcements / live regions | Pass | Error banner is an alert. Offline/stale info banner is a polite live region. |
| Reduce motion | Pass | Kit skeleton: a soft pulse, static under Reduce Motion. The title collapse appears without fading. |
| Images / QR / camera | n/a | |
| Decorative icons | Pass | Status icon, chevron and date box are hidden. |

### Ticket detail + QR (`ticket/[id].tsx` → `TicketDetailScreen`, `TicketQr`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Detail pairs are read as "When: …". Waiver button has a hint and shows busy while loading. |
| Headers | Pass | Event title (the hero `LargeTitle`); back button reads "Back to My tickets". |
| Touch targets | Pass | Kit buttons. |
| Dynamic Type (2.0) | Pass | QR is sized from the window width. The code text wraps if needed. |
| Contrast | Pass | QR is always ink on white with a quiet zone (needed for scanners). |
| Status not colour alone | Fixed | A cancelled ticket's QR was only dimmed (now opacity 0.18). Its label starts "Cancelled ticket, it won't scan". The error banner and the status chip also say it. |
| Reading order | Pass | Title, status, "Show this at the door", QR, details, waiver. |
| Focus | Pass | |
| Announcements / live regions | Pass | Waiver error is an alert. |
| Reduce motion | n/a | |
| Images / QR / camera | Pass | The QR is `image` role. Its label spells the code letter by letter. The printed code is hidden so it isn't read twice. Fixed: `accessibilityIgnoresInvertColors` so Smart Invert doesn't flip the QR. |
| Decorative icons | Pass | |

### Check-in events (`check-in/index.tsx` → `CheckInEventsScreen`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Each event is a button labelled title, time and place, with a hint. |
| Headers | Fixed | Empty and denied titles are headers again (the `EmptyState` fix above). |
| Touch targets | Pass | minHeight 64. |
| Dynamic Type (2.0) | Pass | Text has no fixed heights. |
| Contrast | Pass | |
| Status not colour alone | n/a | |
| Reading order | Pass | |
| Focus | Pass | |
| Announcements / live regions | Pass | Error is an alert with Try again. |
| Reduce motion | n/a | |
| Images / QR / camera | n/a | |
| Decorative icons | Pass | Chevron hidden. |

### Door (`check-in/[eventId].tsx` → `DoorScreen`, `DoorStats`, `GuestSearch`, `VerdictCard`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Tally is one `summary` ("12 of 40 checked in"). Scan button has a hint. Code and name fields are labelled. Guest "Check in" buttons are named "Check in <name>". Queue "Send now", "Clear" and "Try again" are the banners' inline actions (44pt). |
| Headers | Pass | "Type a code" and "Find by name" are headers. |
| Touch targets | Pass | Scan button 64. Verdict buttons minHeight 48, minWidth 96. |
| Dynamic Type (2.0) | Pass | Numeral capped at 1.4× by the kit. The rest wraps. |
| Contrast | Pass | Verdict looks (redesign, mockup 5.13), all from tokens: checked in = `positive` fill with `onPositive` label (white on green 4.9:1 in light, ink on green in dark); already in = `attention` outline; don't admit = `danger` outline; saved offline = dashed ink outline; needs attention = ink outline. Outlined cards keep `text` on `raised`. |
| Status not colour alone | Pass | Each verdict has its own icon (check / repeat / X / clock / alert), shape (fill / heavy outline / dashed) and a title in words. "Saved, not yet confirmed" is dashed and spelled out. Checked-in guests show a check icon and "In at 18:04". |
| Reading order | Pass | Tally, banners, verdict, scan, code, search. |
| Focus | Follow-up | Focus isn't moved to the verdict after a typed-code check-in. It relies on the announcement (device check). |
| Announcements / live regions | Fixed | Verdicts are announced (by `use-door`) and the card is an `alert`. Fixed: guest-search results are now announced ("1 guest found" / "No guests match that name."). The search spinner said "Find by name" and now says "Searching for guests". A checked-in guest's status was read twice; it's now once, and says "Checked in" even with no time. |
| Reduce motion | n/a | No animation. |
| Images / QR / camera | n/a (see scanner) | |
| Decorative icons | Pass | Verdict, check and scan icons hidden. |

### Scanner (`ScannerView`, full screen from the door)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Close and torch are named buttons. Their icons are now hidden. The torch label flips on/off. The permission-loading view was an empty, unlabelled view. It is now a `progressbar` "Starting the camera". |
| Headers | Pass | Permission screens' titles. |
| Touch targets | Pass | 48×48 with an 8dp hitSlop. |
| Dynamic Type (2.0) | Pass | Overlay message wraps. |
| Contrast | Pass (kept) | Fixed ink/white chrome over a live picture: 19.8:1. Pressed fill is `textSecondary` with a white icon: 10:1. |
| Status not colour alone | Pass | Verdict overlay as on the door. |
| Reading order | Pass | Close, torch, camera, message or verdict. |
| Focus | Follow-up (device) | Check VoiceOver focus lands on Close when the scanner opens. |
| Announcements / live regions | Fixed | A camera mount error is now an assertive alert. Verdicts are announced as on the door. |
| Reduce motion | n/a | |
| Images / QR / camera | Fixed | The camera view is now an `image` ("Camera viewfinder. Point it at the ticket's QR code."), with invert colours ignored. |
| Decorative icons | Fixed | X and torch icons hidden. |

### Follow-ups (tickets)
- `use-door.ts` (shared with the outbox slice): `show()` calls `AccessibilityInfo.announceForAccessibility`. Switch it to `announce()` from `@/lib/a11y` so it queues behind VoiceOver on iOS (a scan straight after a focus change can be cut off). On Android the verdict card's `assertive` live region and the announcement may both speak. Keep one.
- `use-door.ts`: the Undo button closes after `UNDO_MS`. A screen reader user may not reach it in time. Keep it open while `useScreenReader()` is true (WCAG 2.2.1). This is a logic change, so it was left for the owner.
- `offline-queue.ts` (outbox slice): no UI, nothing to fix. Make sure any new "sent" / "turned down" result reaches the door UI so it can be announced (the rejected banner is already an alert).
- Door: after a typed-code check-in, consider moving focus to the verdict (`AccessibilityInfo.setAccessibilityFocus`). That needs a ref, so it waits for a device check first.

### Device checks (tickets)
- VoiceOver and TalkBack: scan a valid ticket, an already-used one and a wrong-event one. Each verdict should be spoken once, in full, and Undo should be reachable.
- Name search: type "sa" and hear "N guests found". Double-tap "Check in <name>".
- Ticket detail at the largest text size: the date box in the list, the QR still fits, the code wraps.
- iOS Smart Invert on: the ticket QR and the camera picture stay un-inverted.
- Scanner with VoiceOver: focus starts on Close, the torch toggle reads its new state.

## Prayer

Tests: `src/features/prayer/__tests__/a11y.test.tsx` (10 tests: roles/names/states, 48dp targets, `auditTappables` clean in loading, success, empty, error, permission-denied, set sheet, my sets and practice sheet).

### Prayer tab shell: Frame, Segments, WeekNav (`src/features/prayer/components/Frame.tsx`, `ui.tsx`, `screens/PrayerScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Week / Practice / Mine are `tab`s in a `tablist` with `selected` and "Section n of 3"; prev/next week are named buttons; the week label reads "Week of …". |
| Headers | Pass | Masthead title is a header. |
| Touch targets | Pass | Segments and arrows are 48dp min (tested). |
| Dynamic Type (2.0) | Pass | No fixed text heights; the segment strip grows; WeekNav wraps. |
| Contrast | Pass | Tokens only. |
| Status not colour alone | Pass | Selected segment is inverted AND has `selected` state. |
| Reading order | Pass | Masthead → sections → week stepper → content. |
| Focus | Pass | Section change re-renders in place; focus stays on the tab. |
| Announcements / live regions | Fixed | Errors are danger `Banner`s, which now speak on iOS themselves (kit fix); `ActionNotice` speaks positive results on iOS. |
| Reduce motion | Fixed | Feature-local `useReduceMotion` replaced with the shared `@/lib/a11y` hook (re-exported). |
| Images | n/a | |
| Decorative icons | Fixed | Week chevrons hidden from screen readers. |

### Week (`components/WeekView.tsx`, `SetRow.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Set rows were one sentence without length or lead; now "…, you are on this set. 2 hours. Led by Sample Person 199". |
| Headers | Pass | Each day is a header read as the full date ("Tuesday 3 November"). |
| Touch targets | Pass | Rows 56dp min. |
| Dynamic Type (2.0) | Pass | Title clamps to 2 lines, rest wraps. |
| Contrast | Pass | Tokens; band chip yellow-on-ink (11:1) inverts in dark. |
| Status not colour alone | Pass | "NEEDS A LEAD" chip + words, "YOU"/"INVITED"/"YOUR SET" chips, band name chip, all also in the row's label. |
| Reading order | Pass | Banners (offline / stale / needs-you) before days. |
| Focus | Pass (device) | Sheet is a Modal; OS moves focus into it and back. |
| Announcements / live regions | Pass | Error banner speaks (above). |
| Reduce motion | Pass | No motion on the wall. |
| Images | n/a | |
| Decorative icons | Fixed | Relocation map pin hidden. |

### Set sheet (`components/SetSheet.tsx`, `ui.tsx` Sheet)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Seats read "Prayer Lead, Sample Person 199"; Accept/Decline/Ask name the seat; Ask has a hint; Accept shows `busy`. |
| Headers | Pass | Sheet title (date) and set title are headers; Lineup / Praying are headers. |
| Touch targets | Pass | Kit buttons. |
| Dynamic Type (2.0) | Fixed | Seat-name column was a fixed 104dp; now `minWidth` 104 / `maxWidth` 45%. |
| Contrast | Pass | Scrim is `palette.ink` 45% in both schemes on purpose (not text). |
| Status not colour alone | Pass | "Invited, waiting", "Nobody", "Asked" chip in words. |
| Reading order | Pass | Identity → notice → praying → lineup (leads first) → walk-in → manage. |
| Focus | Pass (device) | `accessibilityViewIsModal`; the scrim is now hidden from screen readers so TalkBack doesn't land on a second "Close". |
| Announcements / live regions | Fixed | Accept / decline / ask results spoken on iOS. |
| Reduce motion | Pass | No slide when reduce motion is on. |
| Images | n/a | |
| Decorative icons | Fixed | 2px lead/other rule hidden. |

### My sets (`components/MySetsView.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Invitations read as one line; buttons name the seat; web rows are links that say "Opens in browser". |
| Headers | Pass | Section bars are headers. |
| Touch targets | Pass | |
| Dynamic Type (2.0) | Pass | |
| Contrast | Pass | |
| Status not colour alone | Pass | |
| Reading order | Pass | Band → result → invitations → serving → leading → more. |
| Focus | Pass | |
| Announcements / live regions | Fixed | Result spoken on iOS. |
| Reduce motion | n/a | |
| Images | n/a | |
| Decorative icons | Pass | ListRow (kit) hides its icons. |

### Practice (`components/PracticeView.tsx`, `PracticeSheet.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Rows read time + "2 of 3 stations open"/"gone"; stations and length are radios with `checked`/`disabled`; full-band station lines are now one element each; the Book button explains why it's disabled (hint). |
| Headers | Pass | Days, "Pick a station", "How long" are headers. |
| Touch targets | Pass | 48dp min (tested). |
| Dynamic Type (2.0) | Fixed | 104dp fixed time / station columns now `minWidth` (tested). |
| Contrast | Follow-up | Past rows use `opacity: 0.6`, which drops the green "n open" text below 4.5:1. The row also says "This time has gone" in words. Visual change, so it's left for design. |
| Status not colour alone | Pass | Open / full / band / gone in words. |
| Reading order | Pass | |
| Focus | Pass (device) | Sheet closes after a booking; focus returns to the screen. |
| Announcements / live regions | Fixed | Booked / cancelled / clash spoken on iOS. |
| Reduce motion | Pass | Sheet. |
| Images | n/a | |
| Decorative icons | n/a | |

**Follow-ups**
- Past practice rows: replace `opacity: 0.6` with a quieter tone that keeps 4.5:1 (design call).
- Kit: done in this branch for `danger` banners. Positive banners still rely on each feature (prayer, bookings `useAnnounceOnIOS`); a kit-level option could replace those.
- Accessible names repeat a just-shown message only once: two identical results in a row are not re-announced.

**Device checks**
- VoiceOver: open a set from the week; focus should land in the sheet; Close returns to the row.
- TalkBack: the scrim is no longer focusable; system back closes the sheet.
- Largest text: set sheet lineup and practice rows/sheet with long seat names ("Worship Lead").
- Accept an invitation with VoiceOver on: "Accepted…" is spoken once.

## Bookings

Shared by every Bookings screen: status is always icon + words (`StatusLine`, `Tag`), never colour
alone; colours all come from tokens (no hard-coded values in the feature); no fixed heights on text
(the only fixed box is the 56dp outbox photo thumbnail); no animation of its own (sheets use
finance's `Sheet`, which skips the slide under reduce motion). New helper in `components/ui.tsx`:
`useAnnounceOnIOS(message)` speaks a message on iOS (which ignores live regions) while Android reads
the visible text's `accessibilityLiveRegion`, so each platform hears it once.

### Bookings layout (`app/(app)/bookings/_layout.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Home back button: "Back: Home", button role. |
| Headers | n/a | Header title is empty; each screen's masthead is the heading. |
| Touch targets | Pass | 48x48 min + hitSlop 8. |
| Dynamic Type (2.0) | Pass | Text "Home" scales; row grows. |
| Contrast | Pass | Tokens. |
| Status not colour alone | n/a | |
| Reading order | Pass | |
| Focus | Pass | Native stack moves focus to the new screen. |
| Announcements / live regions | n/a | |
| Reduce motion | Pass | Native stack transition follows the OS setting. |
| Images / camera | n/a | |
| Decorative icons | Pass | Chevron inside a labelled button. |

### Bookings home (`src/features/bookings/screens/BookingsHomeScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Rows are buttons labelled kind, title, place, dates, time, status; "New request" has a hint. |
| Headers | Pass | Masthead title; section bars are headers with the count. |
| Touch targets | Pass | Kit buttons / rows 48dp+. |
| Dynamic Type (2.0) | Pass | Rows wrap; no fixed heights. |
| Contrast | Pass | Tokens; yellow band carries ink text. |
| Status not colour alone | Fixed | Status icon now hidden (it duplicated the words); words stay. |
| Reading order | Pass | Masthead → band → New request → approvals → queue → lists. |
| Focus | Pass | |
| Announcements / live regions | Pass | Error state / stale note via finance's components; band is a summary. |
| Reduce motion | Pass | Pull-to-refresh only. |
| Images / camera | n/a | |
| Decorative icons | Fixed | Row kind icon hidden (kind is in the label); Plus icon hidden by the kit. |

### Approvals (`src/features/bookings/screens/ApprovalsScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Same BookingRow, with "requested by" in the label. |
| Headers | Pass | Masthead, section bars, empty / no-access titles. |
| Touch targets | Pass | |
| Dynamic Type (2.0) | Pass | |
| Contrast | Pass | |
| Status not colour alone | Pass | |
| Reading order | Pass | |
| Focus | Pass | |
| Announcements / live regions | Pass | |
| Reduce motion | Pass | |
| Images / camera | n/a | |
| Decorative icons | Pass | Empty-state icon hidden by shell `StateMessage`. |

### New request flow (`src/features/bookings/screens/NewRequestScreen.tsx`, `SpaceSteps.tsx`, `VehicleSteps.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Space list was buttons with "Selected" in the label inside a radiogroup: now radios (`ChoiceRow`) with checked/selected state and capacity in the label. A taken vehicle now reports `disabled` (it couldn't be ticked, but sounded tickable). Driver remove "×" labelled "Remove <name>"; date/time fields are one button "Label: value". |
| Headers | Fixed | The step masthead was wrapped in a plain accessible View, which swallowed its header role on device: the wrapper is now a header reading "Step 2 of 5. When?". |
| Touch targets | Pass | All rows/checkboxes/radios 48dp+; remove button 48x48. |
| Dynamic Type (2.0) | Pass | Back/Next buttons wrap their labels; date field value can shrink/wrap (`flexShrink`). |
| Contrast | Pass | |
| Status not colour alone | Pass | "Needs approval / Instant" tags in words; licence status in words; free / clash in words + icon. |
| Reading order | Pass | Step heading → content → error → Back / Next. |
| Focus | Fixed | Next replaces the content under the same button, so focus doesn't move: the new step ("Step 3 of 5. A few details") is now announced. |
| Announcements / live regions | Fixed | Availability "Checking… / That time is free / error" are live regions and spoken on iOS; clash box heading is an alert (spoken on iOS); form errors spoken on iOS; "Request sent / Booking confirmed" announced before the screen is replaced. |
| Reduce motion | Pass | Driver picker sheet skips the slide. |
| Images / camera | n/a | |
| Decorative icons | Fixed | Checkbox squares, × icon, clash icon, date/clock icons hidden. |

### Space detail (`src/features/bookings/screens/SpaceDetailScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Fields read as "Label: value"; Approve/Decline/Cancel buttons; busy state on cancel. |
| Headers | Pass | Masthead, "Decision" bar. |
| Touch targets | Pass | |
| Dynamic Type (2.0) | Pass | Two side-by-side buttons wrap their labels. |
| Contrast | Pass | |
| Status not colour alone | Pass | StatusLine words. |
| Reading order | Pass | |
| Focus | Pass | Decision sheet is modal (`accessibilityViewIsModal`); on close focus returns to the screen. |
| Announcements / live regions | Fixed | "Approved / Declined / Cancelled" and cancel failures were banners only (silent on iOS): now spoken on iOS. Sheet failures use FormError (alert, spoken). |
| Reduce motion | Pass | |
| Images / camera | n/a | |
| Decorative icons | Pass | |

### Vehicle detail (`src/features/bookings/screens/VehicleDetailScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Each driver read as one unit (name, test status, documents). |
| Headers | Fixed | "Collection" / "Return" check titles are now headers. |
| Touch targets | Pass | |
| Dynamic Type (2.0) | Pass | |
| Contrast | Pass | Missing outside-driver documents are danger text AND say which is missing. |
| Status not colour alone | Pass | |
| Reading order | Pass | |
| Focus | Pass | |
| Announcements / live regions | Fixed | Decision / cancel results spoken on iOS (as space detail). |
| Reduce motion | Pass | |
| Images / camera | n/a | |
| Decorative icons | Pass | Button icons hidden by the kit. |

### Collection / return check (`src/features/bookings/screens/InspectionScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Checkboxes (checked), yes/no radios (finance `Chips`), photo buttons "Take a photo: Fuel gauge". |
| Headers | Fixed | "Damage", "Inventory", "Condition" group labels are now headers. |
| Touch targets | Pass | |
| Dynamic Type (2.0) | Pass | Photo buttons side by side wrap. |
| Contrast | Pass | |
| Status not colour alone | Pass | Queue status as a worded tag. |
| Reading order | Pass | Top to bottom, error just above Submit. |
| Focus | Pass | |
| Announcements / live regions | Fixed | "Photo added to …", "Recorded …" and "Saved on this phone …" are now spoken (the success banner was set just before the screen closed, so nobody heard it). Validation errors spoken on iOS. |
| Reduce motion | Pass | |
| Images / camera | Pass | Camera is the system picker (its own labels). Thumbnails are `accessible={false}`; the row text says what each photo is. |
| Decorative icons | Pass | |

### Components (`components/ui.tsx`, `DateTimeField.tsx`, `DecisionSheet.tsx`, `ConflictList.tsx`, `QueueList.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | `CheckRow` gains an `unavailable` (disabled) state; new `ChoiceRow` radio. `DateTimeField`: the visual label above the button was read as well as the button's "Label: value": now hidden from screen readers. |
| Headers | Fixed | QueueList title is a header. |
| Touch targets | Pass | |
| Dynamic Type (2.0) | Pass | |
| Contrast | Pass | |
| Status not colour alone | Pass | ConflictList: blocked = Ban icon + "already booked" title; warning = triangle + its title. |
| Reading order | Pass | |
| Focus | Pass | iOS date/time picker sits in a modal sheet with Done. |
| Announcements / live regions | Fixed | ConflictList's alert role sat on a container that isn't an accessibility element (so it did nothing): the heading now carries it, and it's spoken on iOS. FormError spoken on iOS. |
| Reduce motion | Pass | |
| Images / camera | Pass | |
| Decorative icons | Fixed | StatusLine, BookingRow, CheckRow, ConflictList, DateTimeField icons hidden. |

**Follow-ups (Bookings)**
- Outbox slice (`QueueList.tsx` wiring / `src/features/bookings/outbox/**`): a photo that finishes
  uploading or fails in the background isn't announced; the Retry / Remove pair for each queued
  item could be one row with custom actions (`accessibilityActions`) to cut swipes on long lists;
  the 56dp thumbnail could be labelled with what it shows ("Fuel gauge photo") instead of hidden.
- Finance-owned components Bookings reuses (`Row`, `Chips`, `Tag`, `Sheet`): `Row` has no way to pass
  a role/state, which is why Bookings added `ChoiceRow`; `Chips` puts its visible label outside the
  radiogroup (read twice on iOS).
- `YesNo`'s hint sits below the radios, so it's read after the choice; consider moving it into
  each radio's hint.

**Device checks (Bookings)**
- VoiceOver + TalkBack through a whole space request: each Next announces the new step; the clash
  box is read once (not twice on Android); "Request sent" is heard before the detail screen loads.
- Pick a date on iOS with VoiceOver: the inline calendar in the sheet, then Done.
- Inspection: take a photo with VoiceOver on; "Photo added to …" is spoken after the camera closes.
- Approve a request: "Approved" is spoken on iOS and read from the banner on Android, once each.
- Largest text: Approve / Decline and Back / Next side by side still fit (labels wrap).

## Me, Schools, Sign-in and layouts

### Sign in (`app/(auth)/sign-in.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Fields labelled by the kit `TextField`; show/hide password button; "Sign in" button reports busy/disabled; "Forgot password?" is a link that says it opens the browser. |
| Headers | Pass | "Sign in" is a header (display text). |
| Touch targets | Pass | Fields and button 48dp; forgot-password link `minHeight` 48. |
| Dynamic Type (2.0) | Pass | Body text unlimited, display capped at 1.4; no fixed text heights. Wordmark is an image (fixed 220×26, fine). |
| Contrast | Pass | Tokens only (see contrast test). |
| Status not colour alone | Pass | Errors are words in a danger banner / under the field. |
| Reading order | Pass | Wordmark, heading, intro, banner, fields, error, button, link. |
| Focus | Pass | Email "next" moves to password. Focus isn't moved to the error; it is announced instead. |
| Announcements / live regions | Fixed | The first field error is announced (`announce()`). A failed sign-in is a danger `Banner`, which now announces itself on iOS too (kit fix). Cooldown text is a polite live region. |
| Reduce motion | n/a | No motion. |
| Images | Pass | Wordmark: role image, label "Fire and Fragrance". |
| Decorative icons | Fixed | Yellow brand tick hidden from screen readers. |

### Me (`app/(app)/me/index.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Rows via shell `ListRow` (button / link with "Opens in browser"); disabled deletion row reports disabled; sign-out has a hint ("this phone only"). |
| Headers | Pass | Masthead name; section bars Profile / Settings / About. |
| Touch targets | Pass | Rows 56dp, button 48dp. |
| Dynamic Type (2.0) | Pass | No fixed heights. |
| Contrast | Pass | Tokens. |
| Status not colour alone | Pass | — |
| Reading order | Fixed | Email and Roles now read as one "Email: …" / "Roles: …" element instead of label then value separately. |
| Focus | Pass | Native stack handles focus on push/back. |
| Announcements / live regions | Fixed | Load error is a danger `Banner` with Try again: kit fix keeps its alert role and speaks it on iOS. |
| Reduce motion | n/a | — |
| Images | n/a | No avatar. |
| Decorative icons | Fixed | Row icons/chevrons hidden (kit `ListRow`). |

### Edit profile (`app/(app)/me/edit.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Three labelled fields; phone hint is the field hint; Save reports busy. |
| Headers | Pass | Native header title "Edit profile". |
| Touch targets | Pass | 48dp. |
| Dynamic Type (2.0) | Pass | — |
| Contrast | Pass | Placeholder colour fixed in tokens (light `textQuiet`). |
| Status not colour alone | Pass | Errors in words under each field. |
| Reading order | Pass | — |
| Focus | Follow-up | "next" on first/last name doesn't move focus to the next field (needs refs; logic change, left alone). |
| Announcements / live regions | Fixed | First validation error, "Profile saved." on success (before going back), and save failures (danger `Banner`, kit) are announced. |
| Reduce motion | n/a | — |
| Images | n/a | — |
| Decorative icons | n/a | — |

### Notification settings (`app/(app)/me/notifications.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Each `Switch`: role switch, label = group name, hint = description, `checked` + `busy`. |
| Headers | Pass | Native header; empty / no-access titles are headers. |
| Touch targets | Pass | Row 64dp; native switch. |
| Dynamic Type (2.0) | Pass | Row has `minHeight` only. |
| Contrast | Pass | Light outline/track (`ruleStrong`) now 3.55:1. Switch colour lines belong to the follow-ups slice. |
| Status not colour alone | Pass | "On" / "Off" in words beside each switch. |
| Reading order | Pass | The row text is also readable on its own (a little repetition with the switch; acceptable). |
| Focus | Pass | — |
| Announcements / live regions | Fixed | A failed save (switch flips back) is a danger `Banner`, which now speaks on iOS (kit). |
| Reduce motion | n/a | — |
| Images | n/a | — |
| Decorative icons | Pass | Empty-state icon hidden (kit `StateMessage`). |

### Appearance (`app/(app)/me/appearance.tsx`, `src/features/appearance/AppearanceScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Fixed | Radio group + radios with `checked`. The hint was "Double tap to use this look" / "Selected" (repeats what the platform says, and hid each option's description); it is now the description. |
| Headers | Pass | Native header "Appearance". |
| Touch targets | Pass | Rows 56dp. |
| Dynamic Type (2.0) | Pass | — |
| Contrast | Pass | Unchecked radio ring now 3.55:1 in light (token fix). |
| Status not colour alone | Pass | Square mark + "Selected" word + radio state. |
| Reading order | Pass | — |
| Focus | Pass | — |
| Announcements / live regions | Fixed | Save failure is a danger `Banner`, which now speaks on iOS (kit). |
| Reduce motion | Pass | No motion; one selection haptic. |
| Images | n/a | — |
| Decorative icons | Pass | Radio mark hidden. |

### My Schools (`src/features/schools/screens/SchoolsListScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Enrolment rows: one button "name. status. walking with…" + hint; open schools are links; apply button in the band has a hint. |
| Headers | Pass | Masthead, section bars, empty title. |
| Touch targets | Pass | Rows ≥48dp. |
| Dynamic Type (2.0) | Pass | — |
| Contrast | Pass | Tokens. |
| Status not colour alone | Pass | Status tags are words. |
| Reading order | Pass | — |
| Focus | Pass | — |
| Announcements / live regions | Pass | Error state is finance's `ErrorState` (audited in the finance section). |
| Reduce motion | Pass | Finance `Skeleton` stops pulsing under reduce motion. |
| Images | n/a | — |
| Decorative icons | Fixed | Row chevrons hidden. |

### Enrolment (`src/features/schools/screens/EnrolmentScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Status "Status: Active"; figures read as "Cumulative GPA, 4.00"; course rows one element each with grade in words; transcript is a link. |
| Headers | Pass | — |
| Touch targets | Pass | — |
| Dynamic Type (2.0) | Pass | GPA numeral capped at 1.4; figures wrap (`flexWrap`). |
| Contrast | Pass | — |
| Status not colour alone | Pass | "Now" / "Next" are words. |
| Reading order | Pass | — |
| Focus | Pass | — |
| Announcements / live regions | Pass | — |
| Reduce motion | Pass | — |
| Images | n/a | — |
| Decorative icons | Pass | Not-found icon hidden (kit). |

### My Attendance (`src/features/schools/screens/AttendanceScreen.tsx`)
| Check | Status | Notes |
|---|---|---|
| Labels, roles, state | Pass | Each record one element: "title. date. status. line". |
| Headers | Pass | — |
| Touch targets | n/a | Read-only list. |
| Dynamic Type (2.0) | Pass | Date block uses `minWidth` (grows). |
| Contrast | Pass | — |
| Status not colour alone | Pass | Present / Late / Absent are words. |
| Reading order | Fixed | The summary was one element whose label left out the per-status counts (they were hidden inside it); the counts are now part of its label. |
| Focus | Pass | — |
| Announcements / live regions | Pass | — |
| Reduce motion | Pass | — |
| Images | n/a | — |
| Decorative icons | Pass | Date block hidden (read in the row label). |

### App layouts and tab shell (`app/_layout.tsx`, `app/(app)/_layout.tsx`, `app/(app)/me/_layout.tsx`, `app/(app)/schools/_layout.tsx`, `app/(auth)/_layout.tsx`)
| Check | Status | Notes |
|---|---|---|
| Tab bar | Pass | Custom `TabBar` (tablist / tab / selected) used for every tab; hidden routes (bookings, schools) use `href: null`. |
| Native headers | Pass | Me stack: titles set, back button "minimal" (VoiceOver still says "Back"). |
| Schools "Home" back button | Fixed | Labelled "Back: Home", 48dp + hitSlop; its chevron is now hidden. |
| Auth gate | Pass | Signed-out users see only sign-in; no focus traps. |
| Dynamic Type | Follow-up | Schools' "Home" header button text scales without a cap; at the largest sizes it may crowd the header (device check). |

**Follow-ups (me / schools / auth)**
- Edit profile: return key "next" doesn't move to the next field (needs input refs; not an a11y-attribute change).
- `appearanceStrings.chooseHint` is no longer used; remove it when the file is next touched.
- Schools reuse finance's `Row`, `ErrorState`, `Skeleton`, `Tag`: covered in the finance section.

**Device checks**
- VoiceOver + TalkBack: sign in with a wrong password and hear the error; leave email empty and hear "Enter your email address."
- Me: Email and Roles read as one line each; Edit profile → Save hears "Profile saved."
- Notifications: toggle in airplane mode, hear the failure, switch flips back.
- Appearance: each option reads its description; selected state from the radio.
- Largest text size: Me rows, notification rows, My Attendance summary, Schools "Home" header button.


## Follow-ups for other slices / later (summary)

Files owned by the offline-outbox slice in this batch were audited but not edited:

- `src/features/tickets/use-door.ts`: switch the verdict `AccessibilityInfo.announceForAccessibility` to
  `announce()` (queues behind VoiceOver; avoids a double read on Android with the verdict card's live
  region), keep Undo open while a screen reader is on (`useScreenReader()`), consider moving focus
  to the verdict after a typed-code check-in.
- `src/features/finance/components/OutboxList.tsx`: title should be a header; status changes
  (waiting → sending → failed / sent) are not announced.
- `src/features/{finance,bookings}/outbox/**`: no UI. A background send that finally succeeds or
  fails is never announced; consider an `announce()` from the providers.
- `src/features/tickets/offline-queue.ts`: no UI, nothing to fix.

Not attribute-only changes (left for a later pass): Edit profile "next" key focus chaining; past
practice rows at 60% opacity drop the green "n open" text under 4.5:1 (the row also says it in
words); unused `appearanceStrings.chooseHint` / `selectedHint`; positive banners could announce from
the kit too.

## Device checklist (not done: no device or simulator was available)

1. VoiceOver (iPhone) and TalkBack (Android) swipe through every tab: every stop has a sensible
   name and role; no unnamed "button"; decorative icons, ticks and rules are skipped.
2. Turn on the largest text (iOS Larger Accessibility Sizes; Android font size max + display size
   max) and walk every screen: nothing clipped or overlapping, tab labels shrink to fit, prayer
   time columns and ticket date boxes grow.
3. Trigger an error on each screen (airplane mode): the error is spoken once on both platforms,
   and the Try again button is reachable right after it.
4. Async results are spoken: receipt saved (Team), profile saved, booking request sent, photo
   added, prayer claim / practice booking, door scan verdicts.
5. Reduce Motion on: sheets appear without sliding, the finance skeleton doesn't pulse.
6. Light mode: text-field and chip outlines are clearly visible on white and bone; placeholders
   are readable (token change above).
7. Switch Control / Voice Control (or Android Switch Access): every control reachable, receipt
   zoom buttons work.
8. Smart Invert (iOS): ticket QR and receipt photos are not inverted.
