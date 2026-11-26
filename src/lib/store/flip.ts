// ============================================================
// Store flipbook — layout and page-curl geometry (pure, no DOM)
// ============================================================
// The flipbook component (src/app/(public)/store/_components/flipbook.tsx)
// draws with these; the tests in __tests__/flip.test.ts pin them down.

export type FlipPageSize = { w: number; h: number };

/** Screen widths the flipbook lays out for: phones (< 640px), small tablets, and md+ (768px+). */
export type FlipLayout = "narrow" | "medium" | "wide";

/**
 * One thing on screen: a whole page, or the left / right half of a
 * landscape spread. On wide screens `side` says which side of the open
 * book a portrait page sits on (a landscape page fills both).
 */
export type FlipView = { i: number; half?: "left" | "right"; side?: "left" | "right" };

export const isLandscape = (p: FlipPageSize) => p.w > p.h;

/**
 * What shows together, in reading order.
 *  - narrow (phones, < 640px): one page per screen, and a landscape page (a
 *    spread saved as one PDF page) becomes two screens: its left half, then
 *    its right half, each full-width.
 *  - medium (640–767px): one page per screen, landscape spreads whole.
 *  - wide (md+, 768px+): an open book. The cover sits alone as the
 *    right-hand page, then facing pairs (2–3, 4–5 …). A landscape page is
 *    the whole open spread, never split. A portrait page that can't pair
 *    (the next is landscape, or it's the last) sits alone on the left.
 */
export function buildSpreads(pages: FlipPageSize[], layout: FlipLayout): FlipView[][] {
  if (layout === "narrow") {
    return pages.flatMap((p, i): FlipView[][] => (isLandscape(p) ? [[{ i, half: "left" }], [{ i, half: "right" }]] : [[{ i }]]));
  }
  if (layout === "medium") return pages.map((_, i) => [{ i }]);
  const out: FlipView[][] = [];
  for (let i = 0; i < pages.length; ) {
    if (isLandscape(pages[i])) {
      out.push([{ i }]);
      i += 1;
    } else if (i === 0) {
      out.push([{ i, side: "right" }]);
      i += 1;
    } else if (i + 1 < pages.length && !isLandscape(pages[i + 1])) {
      out.push([{ i, side: "left" }, { i: i + 1, side: "right" }]);
      i += 2;
    } else {
      out.push([{ i, side: "left" }]);
      i += 1;
    }
  }
  return out;
}

/** What one side of the open book shows: a portrait page, or half a landscape page. */
export type FlipSlot = { i: number; half?: "left" | "right" };

/** A wide-screen spread as the two sides of an open book (either may be empty). */
export function slotsOf(spread: FlipView[], pages: FlipPageSize[]): { left?: FlipSlot; right?: FlipSlot } {
  if (spread.length === 1 && pages[spread[0].i] && isLandscape(pages[spread[0].i])) {
    const i = spread[0].i;
    return { left: { i, half: "left" }, right: { i, half: "right" } };
  }
  const out: { left?: FlipSlot; right?: FlipSlot } = {};
  for (const v of spread) out[v.side ?? "right"] = { i: v.i, half: v.half };
  return out;
}

/** Width ÷ height of one page of the open book: the first portrait page, else half the first landscape page. */
export function bookPageAspect(pages: FlipPageSize[]): number {
  const p = pages.find((x) => !isLandscape(x));
  if (p) return p.w / p.h;
  const l = pages[0];
  return l ? l.w / 2 / l.h : 1 / Math.SQRT2;
}

// ────────────────────────────────────────────────────────────
// Page curl
// ────────────────────────────────────────────────────────────
// A leaf W × H, hinged on its left edge (x = 0), is turned by its
// bottom-right corner C = (W, H). The corner travels to P; the fold is the
// perpendicular bisector of C–P. The part of the leaf on the spine side of
// the fold stays flat (its front shows); the part beyond it is reflected
// across the fold (its back shows). This is the classic flat page-curl
// (turn.js, StPageFlip), drawn with clip-path + one 2D matrix, which the
// compositor handles at 60fps on a phone.

export type Pt = { x: number; y: number };

export type CurlFrame = {
  /** Leaf front still lying flat, in leaf coordinates. */
  flat: Pt[];
  /** Clip for the back face, in the back face's own coordinates. */
  backClip: Pt[];
  /** CSS matrix(a, b, c, d, e, f) placing the back face (W × H) in leaf coordinates. */
  backMatrix: [number, number, number, number, number, number];
  /** The part of the leaf that has lifted, in leaf coordinates (where the page beneath shows). */
  lifted: Pt[];
  /** A point on the fold and the unit normal pointing towards the lifted part. */
  fold: { at: Pt; n: Pt };
  /** The same fold seen from the back face (its own coordinates). */
  backFold: { at: Pt; n: Pt };
  /** 0 flat → 1 at mid-turn: how strong the shadows are. */
  depth: number;
};

/** Ease in and out, so a turn starts and lands softly. */
export const easeTurn = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Where the turning corner is at progress t (0 → 1). */
export function cornerAt(t: number, W: number, H: number): Pt {
  const th = Math.PI * Math.min(1, Math.max(0, t));
  // Lifted a little as it travels (always within W of the spine's bottom, so the leaf never tears).
  const lift = Math.min(H * 0.22, W * 0.4);
  return { x: W * Math.cos(th), y: H - lift * Math.sin(th) };
}

/** Clip a convex polygon to the half-plane (p − m)·n ≤ 0 (or ≥ 0 when keepPositive). */
export function clipHalfPlane(poly: Pt[], m: Pt, n: Pt, keepPositive = false): Pt[] {
  const s = keepPositive ? -1 : 1;
  const f = (p: Pt) => s * ((p.x - m.x) * n.x + (p.y - m.y) * n.y);
  const out: Pt[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const u = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  return out;
}

/** The leaf's geometry at progress t (0 = lying on the right, 1 = turned over onto the left). */
export function curlFrame(t: number, W: number, H: number): CurlFrame {
  const C = { x: W, y: H };
  const P = cornerAt(t, W, H);
  const dx = C.x - P.x;
  const dy = C.y - P.y;
  const len = Math.hypot(dx, dy);
  const rect: Pt[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const flatBack = { x: 0, y: 0 };
  if (len < 1e-6) {
    return { flat: rect, backClip: [], backMatrix: [1, 0, 0, 1, 0, 0], lifted: [], fold: { at: C, n: { x: 1, y: 0 } }, backFold: { at: flatBack, n: { x: -1, y: 0 } }, depth: 0 };
  }
  const n = { x: dx / len, y: dy / len };
  const m = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
  const flat = clipHalfPlane(rect, m, n);
  const lifted = clipHalfPlane(rect, m, n, true);

  // Reflect across the fold.
  const R = (p: Pt): Pt => {
    const d = 2 * ((p.x - m.x) * n.x + (p.y - m.y) * n.y);
    return { x: p.x - d * n.x, y: p.y - d * n.y };
  };
  // The back face's point (u, y) is the leaf's point (W − u, y), seen after the fold.
  const T = (u: number, y: number) => R({ x: W - u, y });
  const o = T(0, 0);
  const ex = T(1, 0);
  const ey = T(0, 1);
  const backMatrix: CurlFrame["backMatrix"] = [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y];
  const backClip = lifted.map((p) => ({ x: W - p.x, y: p.y }));
  return {
    flat,
    backClip,
    backMatrix,
    lifted,
    fold: { at: m, n },
    backFold: { at: { x: W - m.x, y: m.y }, n: { x: -n.x, y: n.y } },
    depth: Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
  };
}

/** A polygon as a CSS clip-path (an empty one hides the element). */
export function polygonCss(poly: Pt[]): string {
  if (poly.length < 3) return "polygon(0 0, 0 0, 0 0)";
  return `polygon(${poly.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(", ")})`;
}
