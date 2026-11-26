"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type FlipPage = { n: number; w: number; h: number; url: string };

/** Screen widths the flipbook lays out for: phones (< 640px), tablets, and md+ desktops. */
export type FlipLayout = "narrow" | "medium" | "wide";

/** One thing on screen: a whole page, or the left / right half of a landscape spread. */
export type FlipView = { i: number; half?: "left" | "right" };

const MAX_ZOOM = 4;
const TAP_ZOOM = 2.5;
const SWIPE_PX = 40;

// A plain, fast flipbook. Phones: one page at a time, and a landscape
// spread is split into its left then right half, each full-width (the same
// image, clipped). Tablets: one page at a time, spreads whole. md+: two
// facing pages (cover alone on the right, like a printed magazine). Swipe,
// tap the edges, or use the arrow keys; pinch or double-tap to zoom, drag
// to pan while zoomed. Images load lazily; the next spread is prefetched.
// No download control.
export function Flipbook({
  pages,
  total,
  className,
  onNeedRefresh,
  footer,
}: {
  pages: FlipPage[];
  /** Pages in the whole publication, when only a preview is shown. */
  total?: number;
  className?: string;
  /** Called when a page image fails (its signed link has probably expired). */
  onNeedRefresh?: () => void;
  footer?: React.ReactNode;
}) {
  const [at, setAt] = useState<FlipView>({ i: 0 });
  const [layout, setLayout] = useState<FlipLayout>("medium");

  useEffect(() => {
    const sm = window.matchMedia("(min-width: 640px)");
    const md = window.matchMedia("(min-width: 768px)");
    const set = () => setLayout(md.matches ? "wide" : sm.matches ? "medium" : "narrow");
    set();
    sm.addEventListener("change", set);
    md.addEventListener("change", set);
    return () => {
      sm.removeEventListener("change", set);
      md.removeEventListener("change", set);
    };
  }, []);

  const wide = layout === "wide";
  const spreads = useMemo(() => buildSpreads(pages, layout), [layout, pages]);
  const spreadIndex = Math.max(0, spreads.findIndex((s) => s.some((v) => v.i === at.i && (!v.half || !at.half || v.half === at.half))));
  const spread = spreads[spreadIndex] ?? [{ i: 0 }];

  // ---- zoom + pan --------------------------------------------------------
  const stage = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });
  const zoomed = zoom.s > 1;
  const gesture = useRef<{
    kind: "swipe" | "pan" | "pinch";
    x0: number;
    y0: number;
    z0: { s: number; x: number; y: number };
    d0?: number;
    pinched?: boolean;
    /** Started on an arrow: a tap there turns the page, so it never counts towards a double-tap. */
    onButton?: boolean;
  } | null>(null);
  const [live, setLive] = useState(false); // a finger or mouse is moving the page: no easing
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTouchAt = useRef(0);

  const clamp = useCallback((z: { s: number; x: number; y: number }) => {
    const el = content.current;
    const s = Math.min(MAX_ZOOM, Math.max(1, z.s));
    if (!el || s <= 1) return { s: 1, x: 0, y: 0 };
    const mx = (el.offsetWidth * (s - 1)) / 2;
    const my = (el.offsetHeight * (s - 1)) / 2;
    return { s, x: Math.min(mx, Math.max(-mx, z.x)), y: Math.min(my, Math.max(-my, z.y)) };
  }, []);

  /** Zoom from z0 to scale s, keeping the screen point (cx, cy) where it is. */
  const zoomAt = useCallback(
    (z0: { s: number; x: number; y: number }, s: number, cx: number, cy: number) => {
      const r = stage.current?.getBoundingClientRect();
      if (!r) return clamp({ ...z0, s });
      const px = cx - (r.left + r.width / 2);
      const py = cy - (r.top + r.height / 2);
      const k = s / z0.s;
      return clamp({ s, x: px - (px - z0.x) * k, y: py - (py - z0.y) * k });
    },
    [clamp]
  );

  const toggleZoom = useCallback(
    (cx: number, cy: number) => setZoom((z) => (z.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(z, TAP_ZOOM, cx, cy))),
    [zoomAt]
  );

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = spreads[spreadIndex + dir];
      if (next) {
        setAt(next[0]);
        setZoom({ s: 1, x: 0, y: 0 });
      }
    },
    [spreads, spreadIndex]
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "Escape") setZoom({ s: 1, x: 0, y: 0 });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go]);

  // Prefetch the next spread.
  useEffect(() => {
    for (const v of spreads[spreadIndex + 1] ?? []) {
      const img = new window.Image();
      img.src = pages[v.i].url;
    }
  }, [spreadIndex, spreads, pages]);

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    lastTouchAt.current = Date.now();
    setLive(true);
    const t = e.touches;
    if (t.length >= 2) {
      gesture.current = { kind: "pinch", x0: (t[0].clientX + t[1].clientX) / 2, y0: (t[0].clientY + t[1].clientY) / 2, z0: zoom, d0: dist(t), pinched: true };
      lastTap.current = null;
      return;
    }
    const onButton = e.target instanceof Element && !!e.target.closest("button");
    gesture.current = { kind: zoom.s > 1 ? "pan" : "swipe", x0: t[0].clientX, y0: t[0].clientY, z0: zoom, onButton };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const t = e.touches;
    if (g.kind === "pinch" && t.length >= 2 && g.d0) {
      const s = g.z0.s * (dist(t) / g.d0);
      setZoom(zoomAt(g.z0, s, g.x0, g.y0));
    } else if (g.kind === "pan" && t.length === 1) {
      setZoom(clamp({ s: g.z0.s, x: g.z0.x + t[0].clientX - g.x0, y: g.z0.y + t[0].clientY - g.y0 }));
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    lastTouchAt.current = Date.now();
    const g = gesture.current;
    if (!g) return;
    if (e.touches.length > 0) {
      // One finger lifted from a pinch: carry on as a pan from here.
      if (g.kind === "pinch" && e.touches.length === 1) {
        gesture.current = { kind: "pan", x0: e.touches[0].clientX, y0: e.touches[0].clientY, z0: zoom, pinched: true };
      }
      return;
    }
    gesture.current = null;
    setLive(false);
    if (g.pinched) {
      if (zoom.s < 1.05) setZoom({ s: 1, x: 0, y: 0 });
      return;
    }
    const c = e.changedTouches[0];
    const dx = c.clientX - g.x0;
    const dy = c.clientY - g.y0;
    const moved = Math.hypot(dx, dy);
    if (moved < 10) {
      if (g.onButton) return;
      const now = Date.now();
      const prev = lastTap.current;
      if (prev && now - prev.t < 300 && Math.hypot(c.clientX - prev.x, c.clientY - prev.y) < 30) {
        lastTap.current = null;
        toggleZoom(c.clientX, c.clientY);
      } else {
        lastTap.current = { t: now, x: c.clientX, y: c.clientY };
      }
      return;
    }
    if (g.kind === "swipe" && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  // Mouse: double-click zooms, drag pans while zoomed.
  const mouse = useRef<{ x0: number; y0: number; z0: { s: number; x: number; y: number } } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom.s > 1 && e.button === 0) {
      mouse.current = { x0: e.clientX, y0: e.clientY, z0: zoom };
      setLive(true);
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const m = mouse.current;
    if (m) setZoom(clamp({ s: m.z0.s, x: m.z0.x + e.clientX - m.x0, y: m.z0.y + e.clientY - m.y0 }));
  };
  const endMouse = () => {
    mouse.current = null;
    setLive(false);
  };

  if (pages.length === 0) return null;
  const label = spread
    .map((v) => (v.half ? `${pages[v.i].n} · ${v.half}` : `${pages[v.i].n}`))
    .join("–");
  const coverAlone = spread.length === 1 && wide && spread[0].i === 0 && !isLandscape(pages[0]);

  return (
    <div className={cn("select-none", className)}>
      <div
        ref={stage}
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-bone-2 px-2 py-4 md:px-12 md:py-8",
          zoomed && "cursor-grab active:cursor-grabbing"
        )}
        // Not zoomed: the page still scrolls up and down, and our own
        // handlers take pinches and sideways swipes. Zoomed: we take every move.
        style={{ touchAction: zoomed ? "none" : "pan-y" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          gesture.current = null;
          setLive(false);
        }}
        onDoubleClick={(e) => {
          if (Date.now() - lastTouchAt.current < 800) return; // touch double-taps are handled above
          toggleZoom(e.clientX, e.clientY);
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endMouse}
        onMouseLeave={endMouse}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          ref={content}
          className={cn("flex w-full justify-center", coverAlone && "md:pl-[50%]")}
          style={{
            transform: zoomed ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : undefined,
            transition: live ? "none" : "transform 160ms ease-out",
          }}
        >
          {spread.map((v) => {
            const p = pages[v.i];
            return (
              <div
                key={`${p.n}-${v.half ?? "whole"}`}
                className={cn(
                  "relative w-full animate-fade-up overflow-hidden border border-rule bg-white",
                  isLandscape(p) && !v.half ? "max-w-[min(100%,1120px)]" : "max-w-[min(100%,560px)]"
                )}
                style={{ aspectRatio: `${(v.half ? p.w / 2 : p.w) / p.h}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={v.half ? `Page ${p.n}, ${v.half} half` : `Page ${p.n}`}
                  draggable={false}
                  loading={v.i <= 2 ? "eager" : "lazy"}
                  // A half is the whole spread scaled to the box's height and
                  // clipped to one side: the box is exactly half as wide.
                  className={cn("pointer-events-none h-full w-full", v.half ? "object-cover" : "object-contain")}
                  style={v.half ? { objectPosition: v.half === "left" ? "left center" : "right center" } : undefined}
                  onError={() => onNeedRefresh?.()}
                />
              </div>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => go(-1)}
          disabled={spreadIndex === 0}
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-start pl-1 text-ink opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 md:w-12 md:justify-center md:pl-0",
            // Zoomed, the wide edge zone would swallow pans; only the chip turns the page.
            zoomed ? "pointer-events-none w-12" : "w-1/4"
          )}
        >
          <span className="pointer-events-auto flex h-11 w-11 items-center justify-center border border-ink bg-white"><ChevronLeft className="h-5 w-5" /></span>
        </button>
        <button
          type="button"
          aria-label="Next page"
          onClick={() => go(1)}
          disabled={spreadIndex >= spreads.length - 1}
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end pr-1 text-ink opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 md:w-12 md:justify-center md:pr-0",
            zoomed ? "pointer-events-none w-12" : "w-1/4"
          )}
        >
          <span className="pointer-events-auto flex h-11 w-11 items-center justify-center border border-ink bg-white"><ChevronRight className="h-5 w-5" /></span>
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-ink px-1 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
        <span className="tabular-nums">
          Page {label} <span className="text-[color:var(--text-quiet)]">/ {total ?? pages[pages.length - 1].n}</span>
        </span>
        {footer}
      </div>
    </div>
  );
}

const isLandscape = (p: Pick<FlipPage, "w" | "h">) => p.w > p.h;

/**
 * What shows together, in reading order.
 *  - narrow (phones, < 640px): one page per screen, and a landscape page (a
 *    spread saved as one PDF page) becomes two screens: its left half, then
 *    its right half, each full-width.
 *  - medium (tablets): one page per screen, landscape spreads whole.
 *  - wide (md+): the cover alone, then facing pairs like a printed magazine,
 *    except that a landscape page always shows on its own, and so does a
 *    portrait page whose neighbour is landscape.
 */
export function buildSpreads(pages: Pick<FlipPage, "w" | "h">[], layout: FlipLayout): FlipView[][] {
  if (layout === "narrow") {
    return pages.flatMap((p, i): FlipView[][] => (isLandscape(p) ? [[{ i, half: "left" }], [{ i, half: "right" }]] : [[{ i }]]));
  }
  if (layout === "medium") return pages.map((_, i) => [{ i }]);
  const out: FlipView[][] = [];
  for (let i = 0; i < pages.length; ) {
    if (i === 0 || isLandscape(pages[i]) || i + 1 >= pages.length || isLandscape(pages[i + 1])) {
      out.push([{ i }]);
      i += 1;
    } else {
      out.push([{ i }, { i: i + 1 }]);
      i += 2;
    }
  }
  return out;
}
