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
