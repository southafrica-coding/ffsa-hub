// Test-only helper (imported from __tests__ files, never from app code): walks
// a rendered tree and lists the tappable elements a screen reader user could
// not identify, because they have no role, or neither a label nor any text.
//
//   const problems = auditTappables(screen.container);
//   expect(problems).toEqual([]);

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] };

export type TappableProblem = { testID?: string; role?: string; name: string; problem: string };

function isHidden(n: Node): boolean {
  return (
    n.props.accessibilityElementsHidden === true ||
    n.props.importantForAccessibility === "no-hide-descendants" ||
    n.props["aria-hidden"] === true
  );
}

function textOf(n: Node | string): string {
  if (typeof n === "string") return n;
  if (isHidden(n)) return "";
  return n.children.map(textOf).join("");
}

function isTappable(n: Node): boolean {
  // Pressable / Touchable* render a host View that carries onClick and the
  // responder handlers; Switch and TextInput are their own controls.
  return n.type === "View" && n.props.accessible !== false && typeof n.props.onClick === "function";
}

export function accessibleName(n: Node): string {
  const label = n.props.accessibilityLabel ?? n.props["aria-label"];
  if (typeof label === "string" && label.trim()) return label.trim();
  return textOf(n).trim();
}

export function auditTappables(root: Node | null | undefined): TappableProblem[] {
  const out: TappableProblem[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === "string" || isHidden(n)) return;
    if (isTappable(n)) {
      const role = (n.props.accessibilityRole ?? n.props.role) as string | undefined;
      const name = accessibleName(n);
      const testID = n.props.testID as string | undefined;
      if (!name) out.push({ testID, role, name, problem: "no label or text" });
      else if (!role || role === "none") out.push({ testID, role, name, problem: "no role" });
    }
    n.children.forEach(walk);
  };
  if (root) walk(root);
  return out;
}

/** Style-level sizes of every tappable, for minimum target checks. */
export function tappableSizes(root: Node | null | undefined, flatten: (s: unknown) => Record<string, unknown>) {
  const out: { name: string; testID?: string; minHeight?: number; height?: number; minWidth?: number; width?: number; hitSlop?: unknown }[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === "string" || isHidden(n)) return;
    if (isTappable(n)) {
      const s = flatten(n.props.style);
      out.push({
        name: accessibleName(n),
        testID: n.props.testID as string | undefined,
        minHeight: s.minHeight as number | undefined,
        height: s.height as number | undefined,
        minWidth: s.minWidth as number | undefined,
        width: s.width as number | undefined,
        hitSlop: n.props.hitSlop,
      });
    }
    n.children.forEach(walk);
  };
  if (root) walk(root);
  return out;
}

export type LargeTextProblem = { text: string; problem: string };

/**
 * Dynamic Type check for a rendered tree (design-spec §6: rows grow, titles
 * wrap, only the big display sizes are capped). Lists visible text that
 * opts out of the OS text size, is capped below 1.2×, or is clamped to a
 * number of lines without being listed in `allowClamp` (by its text or
 * testID: deliberate clamps whose full text is a tap away, like a history
 * row). Decorative copies hidden from screen readers (the collapsed nav
 * title) are skipped.
 */
export function largeTextProblems(root: Node | null | undefined, allowClamp: readonly string[] = []): LargeTextProblem[] {
  const out: LargeTextProblem[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === "string" || isHidden(n)) return;
    if (n.type === "Text") {
      const text = textOf(n).trim();
      const testID = n.props.testID as string | undefined;
      const max = n.props.maxFontSizeMultiplier as number | undefined;
      if (n.props.allowFontScaling === false) out.push({ text, problem: "ignores the OS text size" });
      else if (typeof max === "number" && max > 0 && max < 1.2) out.push({ text, problem: `capped at ${max}x` });
      const lines = n.props.numberOfLines as number | undefined;
      // A one-line clamp WITH a scale cap is the bar pattern (nav title, back label, tab label).
      const barPattern = lines === 1 && typeof max === "number";
      if (lines && !barPattern && !allowClamp.some((a) => a === text || a === testID)) {
        out.push({ text, problem: `clamped to ${lines} line(s)` });
      }
      return;
    }
    n.children.forEach(walk);
  };
  if (root) walk(root);
  return out;
}

const shrinks = (s: Record<string, unknown>) => (typeof s.flexShrink === "number" && s.flexShrink > 0) || (typeof s.flex === "number" && s.flex > 0);

/**
 * Where large text would break a word in half (QA, Nov 2026: "Tod/ay",
 * "Need/s you", "Leadershi/p"). The test renderer has no layout, so this
 * reads structure: a row that can't wrap holding a wrapping text beside
 * another text (one squeezes the other to a sliver), a wrapping row whose
 * text may shrink with no minWidth (it squeezes instead of wrapping), text
 * in a column under half the width, or text given a fixed width. Run it
 * with useWindowDimensions mocked to a large fontScale, since the kit
 * stacks side-by-side rows from there. Hidden decoration is skipped.
 */
export function wordBreakRisks(root: Node | null | undefined, flatten: (s: unknown) => Record<string, unknown>): string[] {
  const out: string[] = [];
  const kids = (n: Node) => n.children.filter((c): c is Node => typeof c !== "string" && !isHidden(c));
  const texts = (n: Node): Node[] => (n.type === "Text" ? [n] : kids(n).flatMap(texts));
  const walk = (n: Node) => {
    const s = flatten(n.props.style);
    if (n.type === "Text") {
      if (typeof s.width === "number") out.push(`fixed-width text: ${textOf(n).trim()}`);
      return;
    }
    if (s.flexDirection === "row") {
      const withText = kids(n).filter((c) => texts(c).length > 0);
      const wrapping = (c: Node) => texts(c).some((t) => t.props.numberOfLines === undefined);
      if (s.flexWrap !== "wrap") {
        if (withText.length >= 2 && withText.some(wrapping)) {
          out.push(`side by side: ${withText.map((c) => textOf(c).trim()).join(" | ")}`);
        }
      } else if (withText.length >= 2) {
        // A wrapping row only wraps by size: a text that may shrink, with no
        // floor, is squeezed beside the other instead (QA pass 2: "Auditoriu/m").
        const squeezed = withText.filter((c) => wrapping(c) && shrinks(flatten(c.props.style)) && typeof flatten(c.props.style).minWidth !== "number");
        if (squeezed.length) out.push(`squeezed in a wrapping row: ${withText.map((c) => textOf(c).trim()).join(" | ")}`);
      }
    }
    // A text column under half the width: one long word doesn't fit (QA pass 2: "Objectiv/es").
    const share = [s.width, s.flexBasis].find((v): v is string => typeof v === "string" && v.endsWith("%"));
    if (share && parseFloat(share) < 50 && texts(n).length > 0) out.push(`narrow column (${share}): ${textOf(n).trim()}`);
    kids(n).forEach(walk);
  };
  if (root && !isHidden(root)) walk(root);
  return out;
}
