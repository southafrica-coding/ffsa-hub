# Hub Forms F2 — screenshots and overflow check

Light theme, 390 px wide, device scale 2. `*-fold.png` is the first screen (390×844);
the others are the full page. Phone top bar and tab bar are the real Hub shell.

| Screen | First fold | Full page |
| --- | --- | --- |
| Forms list (`/forms`) | `library-390-light-fold.png` | `library-390-light.png` |
| Builder (`/forms/[id]`) | `builder-390-light-fold.png` | `builder-390-light.png` |
| Route to (a question opened in the builder) | `routing-390-light-fold.png` | `routing-390-light.png` |

## How they were made

The real components (`FormsLibrary`, `FormBuilder`, `AdminSidebar`, `MobileTabBar`) were
rendered on a temporary local route with made-up fixture rows (every name and count is
invented), under `next dev` with the Supabase URL pointed at an unreachable local address.
No database was read or written. The temporary route is not committed. Playwright 1.49
(Chromium) took the shots; the Route to screen is the builder after tapping a question.

## Overflow

`overflow.json`: at 360, 390 and 430 px, for all three screens,
`document.scrollWidth` equals the viewport width. No horizontal overflow, no element
past the right edge.
