import { describe, expect, it } from "vitest";
import { bookPageAspect, buildSpreads, clipHalfPlane, cornerAt, curlFrame, slotsOf } from "../flip";

const P = { w: 1080, h: 1527 };
const L = { w: 1620, h: 1146 };
const whole = (...is: number[]) => is.map((i) => [{ i }]);

describe("flipbook spreads: phones (narrow)", () => {
  it("show one page at a time", () => {
    expect(buildSpreads([P, P, P], "narrow")).toEqual(whole(0, 1, 2));
  });
  it("split a landscape spread into its left then right half, in reading order", () => {
    expect(buildSpreads([P, L, P, L, L], "narrow")).toEqual([
      [{ i: 0 }],
      [{ i: 1, half: "left" }],
      [{ i: 1, half: "right" }],
      [{ i: 2 }],
      [{ i: 3, half: "left" }],
      [{ i: 3, half: "right" }],
      [{ i: 4, half: "left" }],
      [{ i: 4, half: "right" }],
    ]);
  });
  it("small tablets (medium) show one page at a time and keep landscape spreads whole", () => {
    expect(buildSpreads([P, L, P], "medium")).toEqual(whole(0, 1, 2));
  });
});

describe("flipbook spreads: tablet and desktop (wide) are an open book", () => {
  it("shows the cover alone on the right, then 2–3, 4–5", () => {
    expect(buildSpreads([P, P, P, P, P], "wide")).toEqual([
      [{ i: 0, side: "right" }],
      [{ i: 1, side: "left" }, { i: 2, side: "right" }],
      [{ i: 3, side: "left" }, { i: 4, side: "right" }],
    ]);
  });
  it("puts a last odd page alone on the left (the back of the book)", () => {
    expect(buildSpreads([P, P, P, P], "wide")).toEqual([
      [{ i: 0, side: "right" }],
      [{ i: 1, side: "left" }, { i: 2, side: "right" }],
      [{ i: 3, side: "left" }],
    ]);
  });
  it("keeps a landscape PDF page as one whole open spread, never split", () => {
    const s = buildSpreads([P, L, L, P, P], "wide");
    expect(s).toEqual([[{ i: 0, side: "right" }], [{ i: 1 }], [{ i: 2 }], [{ i: 3, side: "left" }, { i: 4, side: "right" }]]);
    expect(s.flat().some((v) => v.half)).toBe(false);
    expect(slotsOf(s[1], [P, L, L, P, P])).toEqual({ left: { i: 1, half: "left" }, right: { i: 1, half: "right" } });
  });
  it("leaves a portrait page alone on the left when the next page is a landscape spread", () => {
    expect(buildSpreads([P, P, L, P, P], "wide")).toEqual([
      [{ i: 0, side: "right" }],
      [{ i: 1, side: "left" }],
      [{ i: 2 }],
      [{ i: 3, side: "left" }, { i: 4, side: "right" }],
    ]);
  });
  it("maps spreads to the two sides of the book", () => {
    const pages = [P, P, P];
    const s = buildSpreads(pages, "wide");
    expect(slotsOf(s[0], pages)).toEqual({ right: { i: 0, half: undefined } });
    expect(slotsOf(s[1], pages)).toEqual({ left: { i: 1, half: undefined }, right: { i: 2, half: undefined } });
  });
  it("sizes each side of the book from a portrait page, or half a landscape one", () => {
    expect(bookPageAspect([L, P])).toBeCloseTo(P.w / P.h);
    expect(bookPageAspect([L])).toBeCloseTo(L.w / 2 / L.h);
  });
});

describe("page curl geometry", () => {
  const W = 400;
  const H = 600;
  const area = (poly: { x: number; y: number }[]) =>
    Math.abs(poly.reduce((s, p, k) => { const q = poly[(k + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;

  it("starts flat and ends fully turned over onto the left", () => {
    const start = curlFrame(0, W, H);
    expect(area(start.flat)).toBeCloseTo(W * H);
    expect(start.lifted).toHaveLength(0);
    const end = curlFrame(1, W, H);
    expect(area(end.flat)).toBeCloseTo(0, 0);
    // Fully turned, the back face lies exactly on [-W, 0]: an identity copy shifted left.
    const [a, b, c, d, e, f] = end.backMatrix;
    expect([a, b, c, d]).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6)]);
    expect(e).toBeCloseTo(-W, 6);
    expect(f).toBeCloseTo(0, 6);
  });

  it("never loses paper: flat + lifted is the whole leaf at every step", () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const fr = curlFrame(t, W, H);
      expect(area(fr.flat) + area(fr.lifted)).toBeCloseTo(W * H, 3);
    }
  });

  it("keeps the turning corner within a page's width of the spine, so the leaf never tears", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const p = cornerAt(t, W, H);
      expect(Math.hypot(p.x, p.y - H)).toBeLessThanOrEqual(W + 1e-9);
    }
  });

  it("clips a square by a half-plane", () => {
    const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(area(clipHalfPlane(sq, { x: 1, y: 0 }, { x: 1, y: 0 }))).toBeCloseTo(2);
    expect(area(clipHalfPlane(sq, { x: 1, y: 0 }, { x: 1, y: 0 }, true))).toBeCloseTo(2);
  });
});
