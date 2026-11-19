# The iPhone redesign ("R" track): what changed, the kit, how to build a screen

The phone app was restyled in November 2026 so it feels like the Hub's
Departments & Services redesign and unmistakably native on iPhone. Behaviour,
data, permissions, API calls and copy stayed the same; the look, the
hierarchy and the shared UI pieces changed.

- Source of truth for the look: `~/CODING/mobile-prompts/redesign/design-spec.md`
  and the mockups (`ffsa-hub-iphone-mockups.html`, frames `sN-n`).
- Tokens, type scale and the R1 old → new table: `docs/redesign-kit.md`.
- Every kit component in light and dark: `src/components/__tests__/gallery.test.tsx`
  (snapshot) and `r4-kit.test.tsx`.

## What changed

| Slice | PR | What |
|---|---|---|
| R1 Foundation | #642 | Tokens (6/8 radius, new light surface and rules, AA text tones), Roboto 900 titles (Roboto Condensed 900 dropped), the component kit, the tab bar (yellow tick + bold label, Home marked for hidden routes, bar hidden on full-screen moments). |
| R2 Home & sign-in | #645 | Collapsing large title, the Needs you band, kit rows, the Home skeleton. |
| R2 Tickets | #646 | Ticket hero + QR, door check-in, verdicts with green "Checked in" (icon + words), volunteer door. |
| R2 Prayer | #647 | Mon–Fri day strip with marker words, set sheet, practice two-column grid, My sets. |
| R2 Finance | #648 | My finance, team, Add expense as a full-height push, the finance-office placeholder row. |
| R2 Me | #649 | Me root, settings-style pushed pages, documents with the photo slot, notifications. |
| R3 Schools & History | #654 | My Schools, enrolment, attendance, My History. |
| R3 Bookings | #656 | Bookings home, the request flow, details, vehicle checks. |
| R3 OKRs, Ministries, Staff decisions | #655 | The wall, owner pages, ministries, staff decisions. |
| R4 Polish and QA | this | One kit (feature duplicates promoted and deleted), Training restyled, re-tap the tab to scroll up / pop, virtualised long lists, Get tickets behind a flag, discard confirm on Add expense, content fade over skeletons, Dynamic Type and contrast tests, this page. |

## The kit (`@/components`)

Everything a screen needs is exported from `src/components/index.ts`. Use
these before writing anything feature-local; if you need something new and
general, add it to the kit with a test, don't copy it into a feature.

**Page frames**

| Component | Use |
|---|---|
| `LargeTitleScrollView` | Every tab root and most pushed screens: eyebrow (yellow tick) + Roboto 900 caps title that collapses into a 16pt nav title. `back={{ label, onPress }}` for pushed screens; `navLeft` / `navRight` for bar controls; `refreshControl`; `gap` between children (16). |
| `LargeTitleList` | The same header over a virtualised `FlatList` (Finance team, My attendance). Draw rows with `ListGroupItem` inside a `Bleed`. |
| `PushedPage` | A pushed page with a compact bar (back + centred sentence-case title, hairline once scrolled), keyboard-aware, optional pull to refresh. The settings-style Me pages, and any pushed screen while its title isn't known (loading, error, not found). `tabBarHidden` for full-height forms. |
| `LargeTitle`, `NavBar`, `BackButton`, `Eyebrow` | The pieces of the above, for custom frames. `NavBar left={…}` puts Cancel / Done where Back would be. |
| `Bleed` / `BLEED` | Pages pad text by the 20pt gutter; cards, lists, bands and banners sit at 16pt. Wrap them in `Bleed`. |
| `Screen`, `NeedsYouBandScope` | The plain frame and the one-band-per-screen scope (the frames above include it). |
| `FadeIn` | Wrap the loaded content that replaces a skeleton: 160ms fade, skipped under Reduce Motion. Give it the parent's `gap`. |

**Lists and sections**

| Component | Use |
|---|---|
| `ListGroup` + `ListRow` | Inset rows: icon tile, title, caption, meta, chevron or "Opens in browser" (`trailing="web"`), unread dot. |
| `GroupRow` | A free-form row (budget bar, date block, chips) with the same metrics; a button when it opens something, a plain element when it only tells. `lead` / `trail` slots, `IconTile`. |
| `InfoRow` | A row that only tells (roster line, placeholder). |
| `SwitchRow`, `RadioRow`, `StaticRow` | Rows whose switch / radio / trailing action VoiceOver can reach. `RadioRow mark="leading"` puts the ring first. `RadioMark` alone. |
| `ListGroupItem` | One row of a `ListGroup` drawn by a `FlatList`. |
| `SectionHeader` | 15/600 section title with an optional underlined action (`actionAccessibilityLabel`, `actionTestID`, spoken `accessibilityLabel`). |
| `SectionTitle` | Section title with a quiet count on the right, read as one heading ("Outreach teams, 3 teams"). |

**Status, bands and messages**

| Component | Use |
|---|---|
| `NeedsYouBand` | THE yellow band: eyebrow, text, optional `detail` line and black action (`actionAccessibilityLabel`, `actionAccessibilityHint`). At most one per screen, only from real data. |
| `StatusChip` | 24pt chip, word + icon (word alone only when the word is the whole meaning). |
| `StatusLine` | Icon + words in a line ("2 receipts waiting"). |
| `Banner` | info / offline / queued / positive / error, full border + icon, inline action (`actionBusy` shows a spinner). |
| `LoadError` / `LoadFailed` | Couldn't load: what happened, what to do, Try again (banner / calm card). |
| `StaleNote` / `Freshness` | The saved copy is showing: "Last updated 09:05", or "Couldn't refresh. Showing what was saved at 09:05." + Try again. `Freshness` takes a `useCachedLoad` state. |
| `EmptyState` | Calm card: icon circle, title, one line, optional action. |
| `Skeleton` / `SkeletonList` | Placeholders in the final layout, one labelled progress element, static under Reduce Motion. |

**Controls**

| Component | Use |
|---|---|
| `Button` | primary (ink/white light, yellow/black dark), secondary, text (underlined), danger, dangerFill, ghost; 50pt (44 `size="small"`). |
| `TextField` | Label above, 48pt, focus ring, error line. |
| `SelectField` | Looks like a field, opens a sheet. |
| `ChoiceChips` / `ChipButton` | Choice chips (36pt, 44pt hit area), filled ink + bold when chosen. |
| `SegmentedControl` | Tab list (always one selected). |
| `ChoiceSegments` | The same look as a radio group that can start empty (Yes / No answers). Options are `choice-<value>`. |
| `Toggle` | Native switch, ink (light) / yellow (dark). |
| `Disclosure`, `FieldError` | "More details" row; the error line for non-text controls. |
| `Sheet` | The one bottom sheet: grabber, 17/600 title, ×, `footer`, keyboard avoidance, `subtitleAccessibilityLabel`. |
| `PhotoSlot`, `MoneyText`, `WebHint`, `Divider` | Document photos; money with tabular figures; "Opens in browser"; rules. |

**Behaviour hooks**: `useTabReselect`, `useScrollToTopOnTabPress` (already
inside the page frames: re-tapping the active tab scrolls to the top, and at
the top pops the tab's stack to its root). `selectionHaptic`.

## How to build a new screen in the new style

1. **Route**: a file under `app/(app)/<tab>/…` with `headerShown: false` in its
   stack (the screen draws its own header). Hidden routes (opened from Home)
   are listed in `features/shell/tabs.ts` `HOME_ROUTES` so Home stays marked.
   Full-screen moments (QR, scanner, full-height forms) go in
   `TAB_BAR_HIDDEN_ROUTES`.
2. **Frame**: `LargeTitleScrollView` (or `LargeTitleList` for long lists).
   Eyebrow = the context line, title in sentence case (the kit draws caps).
   Pushed: `back={{ label: <the parent screen's title>, onPress: router.back }}`.
3. **States**, in this order: loading → `SkeletonList` in the final layout;
   error with nothing saved → `LoadError` / `LoadFailed` with Try again;
   saved copy → `Freshness`; empty → `EmptyState`; ready → content inside
   `FadeIn`. Permission denied (403) → an `EmptyState` that says who it's for.
4. **Content**: cards in a `Bleed`; `SectionTitle` / `SectionHeader`; rows in
   a `ListGroup`; statuses as `StatusChip`s with words; at most one
   `NeedsYouBand`, driven by data the screen already has.
5. **Copy** in the feature's `strings.ts`. Sentence case everywhere except the
   page title (and its eyebrow, and the band eyebrow).
6. **Tests**: each state in light and dark, `auditTappables` (every control has
   a role and a name), `largeTextProblems` at fontScale 3.1 on a 360pt screen,
   and the 44pt floor.

```tsx
export default function ThingsScreen() {
  const router = useRouter();
  const { state, refreshing, refresh, retry } = useCachedLoad({ … });
  return (
    <LargeTitleScrollView
      eyebrow={s.context}
      title={s.title}
      back={{ label: s.parentTitle, onPress: () => router.back() }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      {state.status === "loading" ? <Bleed><SkeletonList label={s.loading} inset={false} /></Bleed> : null}
      {state.status === "error" ? <Bleed><LoadError title={s.errorTitle} message={state.message} onRetry={retry} /></Bleed> : null}
      {state.status === "ready" ? (
        <FadeIn style={{ gap: space.lg }}>
          <Freshness state={state} onRetry={retry} bleed />
          <SectionTitle title={s.list} meta={state.data.length} tight />
          <Bleed>
            <ListGroup inset={false}>{state.data.map((t) => <ListRow key={t.id} title={t.name} onPress={() => open(t)} />)}</ListGroup>
          </Bleed>
        </FadeIn>
      ) : null}
    </LargeTitleScrollView>
  );
}
```

## Rules the sweep enforced (check these in review)

- **Tokens only** (`useTheme()` / `src/theme/tokens.ts`); no hex colours in
  features. Yellow is a fill with black text, never text on white. Bone
  `#C5C2AE` is text on black only. No shadows.
- **One caps moment** per screen: the page title (+ its eyebrow and the band's
  eyebrow). Exceptions kept from the mockups: date tiles ("NOV") and the
  prayer band chips (MORNING / NOON / NIGHT, as the wall names them).
- **One yellow band** per screen (the scope warns in development).
- **Radius**: 6 controls, 8 cards / sheets / band. Circles and pill bars
  (progress tracks, radio rings, badges) use half their height.
- **Spacing**: page-level spacing on the scale 4 · 8 · 12 · 16 · 24 · 32 · 48,
  gutter 20, cards at 16. Inside components the mockups' own micro-steps
  are kept: 2 (title/caption), 6 (chip gaps, label to field) and 10 (row
  vertical padding, mockup `.row`).
- **Chips carry a word** (and usually an icon). Active tab = yellow tick AND
  bold label.
- **Back labels** name the parent screen's title (a vehicle check goes back to
  the booking's name; a student record to "Training").
- **"Opens in browser"** is the only wording for web links (`WebHint`,
  `ListRow trailing="web"`).
- **Tab bar** hidden exactly on the ticket QR, the door/scanner route, Add
  expense, the receipt viewer, new booking, vehicle checks, Edit profile and
  the household member form; the volunteer door is outside the tabs. Hidden
  routes (Bookings, Schools, History, OKRs, Ministries, Staff decisions) mark
  Home.
- **Targets** ≥ 44pt (48 in the tab bar); nothing below 11pt; text grows with
  Dynamic Type (only the display sizes are capped).

## Haptics (what the app does, and the spec's wording updated)

Design-spec §6 suggested `impactLight` after save / approve / accept. Jack
decided (R3 review, 19 Nov 2026) to **keep the success notification haptic**
the app already plays after the server confirms a save, approval or send, so
the spec now reads:

- Scan OK → `notificationSuccess`; already in → `Warning`; not valid → `Error`.
- Save / approve / accept / send, after the server confirms →
  `notificationSuccess` (a queued, saved-on-this-phone result → `Warning`;
  a refusal → `Error`).
- Segmented controls, the day strip, chips → `selectionChanged`
  (`selectionHaptic`). Pull to refresh on Home → a light impact.

## Testing notes

- Reanimated: one stand-in for every test, `test/reanimated-mock.ts`, registered
  in `jest.setup.ts` as both `react-native-reanimated` and `…/mock` (what
  expo-router's testing library re-mocks it with). Add to that file if a
  screen needs another Reanimated export.
- `renderRouter` (expo-router/testing-library) turns on fake timers: advance
  them inside `act` to let a stack pop or a scroll land
  (`app/__tests__/tab-reselect.test.tsx`).
- Saved-copy times come from `@/lib/saved-at`; tests that pin "09:05" mock it.
- `auditTappables`, `tappableSizes`, `largeTextProblems`: `src/lib/a11y/testing.ts`.

## Manual device checklist (for Jack; no simulator was available to the agents)

Run each pass in **light and dark**, at the **default and the largest** text
size (Settings → Accessibility → Display & Text Size → Larger Text, slider at
the far right), on a **360pt-wide** phone (iPhone SE / Display Zoom) and a
**430pt** one (Pro Max).

**Every tab**
1. The large title collapses into the small nav title on scroll; under Reduce
   Motion the nav title appears without fading.
2. Content fades in over the skeleton (no fade under Reduce Motion).
3. Tap the active tab when scrolled down: it scrolls to the top. Tap again: a
   pushed screen pops to the tab root. Same from a hidden route opened from
   Home (Bookings, Schools…): Home stays marked.
4. No sideways scrolling anywhere at 360pt; long titles wrap.
5. Pull to refresh works under the collapsing header.

**Home**: band (two lines + Open), Mark all read, the skeleton, offline banner.
**Training** (training staff account): the section switcher fits at 360pt with
the largest text; Today band and tick boxes; a student record and its back
label; the check-in modal's top safe area.
**Finance**: My finance band; the finance-office row also for a finance-staff
account on no team; a team with 100+ expenses scrolls smoothly; Add expense
opens with no tab bar, Cancel on an empty form leaves at once, Cancel after
typing asks "Discard this expense?"; the keyboard never covers Save.
**Prayer**: day strip at 360pt; set sheet subtitle and VoiceOver reading it as
"Wednesday 18 November, 8 to 9:30 am"; practice grid.
**Tickets**: no Get tickets row (flag off); ticket QR with no tab bar; door:
go offline, scan, back online → Send now shows a spinner while sending;
volunteer door (`/scan/<token>`): Done is on the LEFT.
**Me**: pushed pages' compact bar; switches reachable; the keyboard in Edit
profile; Appearance radios.
**Bookings / Schools / History / OKRs / Ministries / Staff decisions**: section
counts read with their titles; My attendance with a long record scrolls
smoothly; the vehicle-check back button names the booking; the staff decision
sheet's note stays above the keyboard; the schools band button says where it
goes (VoiceOver hint).

**VoiceOver pass** (light, default text, then once at the largest size):
- **Home**: band reads "Needs you. N things need you. {title}", the button
  "Open: {title}"; "Mark all N as read"; rows read title, time, unread.
- **Finance → Add expense**: every field is named once; choice chips read
  "radio button, selected"; errors are announced; Cancel → the discard alert.
- **Tickets → door**: code field, Check in, verdicts spoken once with their
  words; the queue banner and Send now (busy while sending).
