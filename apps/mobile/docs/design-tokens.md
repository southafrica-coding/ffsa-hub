# FFSA Hub — design tokens extracted from the web app

> **Phone app note (18 Nov 2026):** this file records the *web's* tokens as extracted on 1 Nov.
> The phone app's live values are in `apps/mobile/src/theme/tokens.ts`; the iPhone redesign moved
> several of them (6/8pt radius, light surface `#FBFAF7`, rule `#E7E4D9`, ruleStrong `#8E8A7C`,
> greys `#55524A`/`#6B675D`, danger `#D92D20`, Roboto 900 titles instead of Roboto Condensed
> 900). See `apps/mobile/docs/redesign-kit.md`.

Sources: `src/app/globals.css` (read to ~line 490 of 602), `tailwind.config.ts`, `CLAUDE.md` (redesign section), `docs/redesign/design` readme, `src/components/mobile-tab-bar.tsx`. Prepared 1 Nov 2026. Items marked (unverified) were inferred.

## 1. The web's committed direction: "MOVEMENT, QUIET" (option 2a)
Light, editorial, hard-edged. Premium via type and structure, not colour volume. **Light-only today — no dark theme exists.** Rules from CLAUDE.md:
- No rounded corners (`--radius: 0`; every Tailwind radius is overridden to 0).
- No shadows (every shadow overridden to `none`). Borders and hairline rules instead of elevation.
- Black bars for section headers; real tables for lists; "never a card grid where a table would do".
- **One yellow "NEEDS YOU" band per screen**, never two. Hairline yellow ticks (masthead tick, lead-KPI mark) are allowed alongside.
- Never invent a signal to fill a band; no progress bar without a real ratio.
- Voice: plain, direct ("4 staff members are waiting on approval").
- FFX logo only for FFX schools; elsewhere use the FF wordmark/mark.
- Event brand kits (storefronts, emails) keep their own identity; out of scope for the admin app.

## 2. Colour
| Token | Value | Use |
|---|---|---|
| ink / primary / text-primary | `#0A0A0A` | primary buttons, headers, body text |
| white (surface-1) | `#FFFFFF` | page background, cards |
| bone (surface-2) | `#F4F2EA` | module panel, secondary surfaces |
| bone-2 (surface-3) | `#F1EFE7` | booked blocks, subtle fills |
| bone-3 (surface-4) | `#E7E4D9` | pressed/strong fills |
| rule | `#DEDACE` | hairlines (shadcn `--border` = HSL 45 18% 88% ≈ `#E7E4D9`) |
| rule-strong | `#C7C3B5` | stronger dividers; input border (HSL 42 12% 78%) |
| text-secondary | `#45423B` | |
| text-tertiary | `#7C786C` | |
| text-quiet | `#9A9689` | |
| yellow | `#FFB801` | the single "needs you" accent, active tab |
| yellow-dim | `#FFF4D9` | |
| yellow-border | `#0A0A0A` | heavy black border on yellow blocks |
| green | `#3E7F2B` (text `#2F6620`) | positive |
| amber | `#8A6400` (border `#B98600`) | attention |
| blue | `#000DE5` | brand blue, "mostly unused in-app" |
| destructive | HSL 0 62% 42% ≈ `#B02929` | errors, deletes |
Also seen in components: `#8E8A7C`, `#1C1C1A`.

## 3. Typography
| Role | Font | Notes |
|---|---|---|
| Body | **Roboto** (300–900) | base 14px / line-height 1.6 (globals.css body) |
| Mastheads, numerals, h1–h3 | **Roboto Condensed** 900, UPPERCASE | letter-spacing −0.01em, line-height 0.9–0.95; masthead title `clamp(34px, 7.5vw, 58px)` |
| Labels | **Roboto Mono**, ALL-CAPS, wide tracking | 9–11px, letter-spacing 0.10–0.20em; `masthead-context` 10px/700/0.2em with 16×3px yellow tick |
| Numerals | Roboto Condensed 900, `tabular-nums` | "one big number per screen" on mobile |
| Event pages only | Bebas Neue, Anton, Space Mono, Big Shoulders Display | per-event brand kits; bundled woff2 in `/public/brand/fonts` — not needed in the app |
Observed sizes: dialog title 28px/900; table/dialog body 13.5–14.5px; chips 11px; tiny mono 9–9.5px.
**Mobile note:** 9–10px mono labels are below comfortable phone sizes and will need a minimum (suggest ≥11pt) and Dynamic Type/font-scale support.

## 4. Spacing, sizes, structure
- Masthead padding 20×20×16 (mobile) → 24×32×20 (≥768px); 1px black bottom border.
- Section header: black bar, mono caps label (10px, 0.14em).
- Cards: header band + body band, zero shadow, 1px border `rule`.
- Touch targets: CLAUDE.md says **44px+**; mobile tab bar uses **48px** targets, bottom safe-area inset. Prayer-room phone rows 46px+.
- Desktop frame (not for app): 74px black icon rail, 212px bone panel.
- No official spacing scale found beyond Tailwind defaults. (unverified: a 4/8 pt scale would be adopted.)

## 5. Icons and assets
- Icons: Lucide (local SVGs). RN equivalent: `lucide-react-native`.
- Brand files in `public/brand/`: `ff-wordmark-black.png`, `ff-wordmark-white.png`, `ff-mark-black.png`, `ff-mark-white.png` (+ `@email` variants); FFX files (`ffx-*.png`) only for FFX schools. Others (wild-ones, preachers) are event/ministry brands.
- Tagline constant `FFSA_TAGLINE` (split by "·") on the login screen.
- App icon / splash: no dedicated mobile icon found in the tree. **A 1024×1024 app icon, adaptive Android icon and splash must be designed** (decision for Jack). (unverified: none exists elsewhere.)
- Photography: dropped in by the user via `<image-slot>` ids (photo-login, photo-event-hero, …) — the app needs a rule for where photos come from.

## 6. Mobile pattern already designed on web (frame 4d, "Mobile portal")
Bottom tab bar, 4 tabs: **School (/my-schools) · Finance (/my-finance) · Prayer (/prayer-room) · Me (/profile)**; active tab = yellow. Prayer room mobile: day as a vertical run, set line-up, "Mine".

## 7. Tension to resolve (decision H)
The web identity is **brutalist/editorial, light-only, square, flat**. Jack asked for "extremely modern, industry standard". Those can both be true, but the native app needs an explicit call: (a) faithful port of the brand look, (b) same palette + type, but native-feeling components (platform haptics, sheets, large titles, motion, dark mode), or (c) full refresh. See plan.md H.

## 8. Proposed mobile token mapping (starting point, not final)
```
color.ink #0A0A0A | color.bg #FFFFFF | color.bone #F4F2EA | color.bone2 #F1EFE7
color.rule #DEDACE | color.accent #FFB801 | color.positive #3E7F2B | color.warning #8A6400 | color.danger #B02929
dark (new, proposed): bg #0A0A0A, surface #161614, rule #2A2924, text #F4F2EA, accent #FFB801 (unchanged)
radius: 0 (faithful) or 2–6 (modern); elevation: none, use borders; motion: 150–250ms standard easing
type: Roboto Condensed 900 caps (display), Roboto (body 16 base on phone), Roboto Mono caps (labels ≥11)
min target: 48
```
