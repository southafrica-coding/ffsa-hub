"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  bookPageAspect,
  buildSpreads,
  curlFrame,
  easeTurn,
  isLandscape,
  polygonCss,
  slotsOf,
  type FlipLayout,
  type FlipSlot,
  type FlipView,
  type Pt,
} from "@/lib/store/flip";
import { useReaderSound } from "./reader-sound";

export { buildSpreads, type FlipLayout, type FlipView } from "@/lib/store/flip";

export type FlipPage = { n: number; w: number; h: number; url: string };

const MAX_ZOOM = 4;
const TAP_ZOOM = 2.5;
const SWIPE_PX = 40;
const TURN_MS = 680;

type Turn = {
  /** The earlier spread (the leaf's front is on it) and the later one. */
  a: number;
  b: number;
  dir: 1 | -1;
};

// A magazine-style flipbook.
//  - Phones (< 640px): one page at a time, full width; a landscape spread is
//    split into its left then right half (the same image, clipped).
//  - 640–767px: one page at a time, spreads whole.
//  - md+ (768px+): an open book. Two facing pages with a spine shadow; the
//    cover alone on the right; a landscape spread is the whole open book.
// Every turn (swipe, edge tap, arrows, keys) plays a page curl and a flip
// sound; with prefers-reduced-motion the page just changes, silently.
// Pinch or double-tap to zoom, drag to pan while zoomed. Images load
// lazily; the spreads either side are prefetched. No download control.
export function Flipbook({
  pages,
  total,
  className,
  onNeedRefresh,
  footer,
  musicUrl,
  onMusicExpired,
}: {
  pages: FlipPage[];
  /** Pages in the whole publication, when only a preview is shown. */
  total?: number;
  className?: string;
  /** Called when a page image fails (its signed link has probably expired). */
  onNeedRefresh?: () => void;
  footer?: React.ReactNode;
  /** Short-lived signed link to this product's background music, if it has any. */
  musicUrl?: string | null;
  /** The music link failed (probably expired): fetch a new one. */
  onMusicExpired?: () => void;
}) {
  const [at, setAt] = useState<FlipView>({ i: 0 });
  const [layout, setLayout] = useState<FlipLayout>("medium");
  const [reduced, setReduced] = useState(false);
  const sound = useReaderSound({ musicUrl, onMusicExpired });

  useEffect(() => {
    const sm = window.matchMedia("(min-width: 640px)");
    const md = window.matchMedia("(min-width: 768px)");
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => {
      setLayout(md.matches ? "wide" : sm.matches ? "medium" : "narrow");
      setReduced(rm.matches);
    };
    set();
    for (const q of [sm, md, rm]) q.addEventListener("change", set);
    return () => {
      for (const q of [sm, md, rm]) q.removeEventListener("change", set);
    };
  }, []);

  const wide = layout === "wide";
  const spreads = useMemo(() => buildSpreads(pages, layout), [layout, pages]);
  const spreadIndex = Math.max(0, spreads.findIndex((s) => s.some((v) => v.i === at.i && (!v.half || !at.half || v.half === at.half))));
  const spread = spreads[spreadIndex] ?? [{ i: 0 }];
  const pageAspect = useMemo(() => bookPageAspect(pages), [pages]);

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

  // ---- turning -----------------------------------------------------------
  const book = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const turning = useRef(false);
  const pending = useRef<1 | -1 | null>(null);
  const { flip } = sound;

  const go = useCallback(
    (dir: 1 | -1) => {
      if (turning.current) {
        pending.current = dir; // one turn queued; the rest of a flurry is dropped
        return;
      }
      const target = spreadIndex + dir;
      const next = spreads[target];
      if (!next) return;
      setZoom({ s: 1, x: 0, y: 0 });
      if (reduced || !book.current) {
        setAt(next[0]);
        return;
      }
      turning.current = true;
      flip();
      setTurn(dir > 0 ? { a: spreadIndex, b: target, dir } : { a: target, b: spreadIndex, dir });
    },
    [spreads, spreadIndex, reduced, flip]
  );

  const finishTurn = useCallback(
    (t: Turn) => {
      const land = spreads[t.dir > 0 ? t.b : t.a];
      if (land) setAt(land[0]);
      setTurn(null);
      turning.current = false;
    },
    [spreads]
  );

  // Play the queued turn once the last one has landed.
  useEffect(() => {
    if (!turn && pending.current) {
      const d = pending.current;
      pending.current = null;
      go(d);
    }
  }, [turn, go]);

  // A layout change mid-turn: just land.
  useEffect(() => {
    setTurn(null);
    turning.current = false;
    pending.current = null;
  }, [layout]);

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

  // Prefetch the spreads either side.
  useEffect(() => {
    for (const v of [...(spreads[spreadIndex + 1] ?? []), ...(spreads[spreadIndex - 1] ?? [])]) {
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

  // The book's box: an open book on wide screens, otherwise the page (or half) on screen.
  const view = spread[0];
  const p0 = pages[view.i];
  const bookAspect = wide ? 2 * pageAspect : (view.half ? p0.w / 2 : p0.w) / p0.h;
  const bookWidth = wide
    ? `min(100%, ${Math.round(2 * 640)}px, calc((100vh - 300px) * ${(2 * pageAspect).toFixed(4)}))`
    : isLandscape(p0) && !view.half
      ? "min(100%, 1120px)"
      : "min(100%, 560px)";

  const face = (s: FlipSlot | undefined, opts?: { alt?: string; eager?: boolean }) =>
    s ? <Face page={pages[s.i]} half={s.half} alt={opts?.alt ?? ""} eager={opts?.eager} onError={onNeedRefresh} /> : null;

  let body: React.ReactNode;
  if (turn) {
    const A = spreads[turn.a] ?? [];
    const B = spreads[turn.b] ?? [];
    if (wide) {
      const sa = slotsOf(A, pages);
      const sb = slotsOf(B, pages);
      body = (
        <>
          {sa.left && <Side side="left">{face(sa.left)}</Side>}
          {sb.right && <Side side="right">{face(sb.right)}</Side>}
          {(sa.left || sb.right) && <Spine left={!!sa.left} right={!!sb.right} />}
          <Leaf key={`${turn.a}-${turn.b}`} turn={turn} wide bookRef={book} onDone={finishTurn} front={face(sa.right) ?? <Paper />} back={face(sb.left) ?? <Paper />} />
        </>
      );
    } else {
      body = (
        <>
          <div className="absolute inset-0">{face(B[0])}</div>
          <Leaf key={`${turn.a}-${turn.b}`} turn={turn} wide={false} bookRef={book} onDone={finishTurn} front={face(A[0])} back={<Paper />} />
        </>
      );
    }
  } else if (wide) {
    const s = slotsOf(spread, pages);
    const whole = spread.length === 1 && isLandscape(pages[spread[0].i]);
    body = (
      <>
        {whole ? (
          <div className="absolute inset-0 shadow-[0_1px_4px_rgba(0,0,0,0.16)]">{face({ i: spread[0].i }, { alt: `Page ${pages[spread[0].i].n}`, eager: true })}</div>
        ) : (
          <>
            {s.left && <Side side="left">{face(s.left, { alt: `Page ${pages[s.left.i].n}`, eager: true })}</Side>}
            {s.right && <Side side="right">{face(s.right, { alt: `Page ${pages[s.right.i].n}`, eager: true })}</Side>}
          </>
        )}
        <Spine left={!!s.left} right={!!s.right} />
      </>
    );
  } else {
    body = (
      <div className="absolute inset-0 shadow-[0_1px_4px_rgba(0,0,0,0.16)]">
        {face(view, { alt: view.half ? `Page ${p0.n}, ${view.half} half` : `Page ${p0.n}`, eager: true })}
      </div>
    );
  }

  return (
    <div className={cn("select-none", className)}>
      <div
        ref={stage}
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-bone-2 px-2 py-4 md:px-14 md:py-6",
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
          className="flex w-full justify-center"
          style={{
            transform: zoomed ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : undefined,
            transition: live ? "none" : "transform 160ms ease-out",
          }}
        >
          <div ref={book} data-flip-book className="relative" style={{ width: bookWidth, aspectRatio: `${bookAspect}` }}>
            {body}
          </div>
        </div>
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => go(-1)}
          disabled={spreadIndex === 0}
          className={cn(
            "absolute inset-y-0 left-0 z-10 flex outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-yellow items-center justify-start pl-1 text-ink opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 md:w-14 md:justify-center md:pl-0",
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
            "absolute inset-y-0 right-0 z-10 flex outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-yellow items-center justify-end pr-1 text-ink opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 md:w-14 md:justify-center md:pr-0",
            zoomed ? "pointer-events-none w-12" : "w-1/4"
          )}
        >
          <span className="pointer-events-auto flex h-11 w-11 items-center justify-center border border-ink bg-white"><ChevronRight className="h-5 w-5" /></span>
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-ink px-1 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
        <span className="tabular-nums">
          Page {label} <span className="text-[color:var(--text-quiet)]">/ {total ?? pages[pages.length - 1].n}</span>
        </span>
        <span className="flex items-center gap-3">
          {footer}
          <button
            type="button"
            data-sound-toggle
            onClick={sound.toggle}
            aria-pressed={sound.on}
            aria-label={sound.on ? "Mute sound" : sound.hasMusic ? "Play music and page sounds" : "Turn on page sounds"}
            title={sound.on ? "Mute" : "Sound on"}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 text-ink"
          >
            {sound.on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            <span className="hidden sm:inline">{sound.hasMusic ? "Music" : "Sound"}</span>
          </button>
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Pieces
// ────────────────────────────────────────────────────────────

/** A page (or half a landscape page) filling its box. */
function Face({ page, half, alt, eager, onError }: { page: FlipPage; half?: "left" | "right"; alt: string; eager?: boolean; onError?: () => void }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={page.url}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        // A half is the whole spread at twice the box's width, shifted so one
        // side shows: the box is exactly half as wide as the spread.
        className={cn("pointer-events-none absolute top-0 h-full object-contain", half ? "max-w-none" : "left-0 w-full")}
        style={half ? { width: "200%", left: half === "left" ? 0 : "-100%" } : undefined}
        onError={() => onError?.()}
      />
    </div>
  );
}

function Paper() {
  return <div className="absolute inset-0 bg-[#FBFAF6]" />;
}

/** One side of the open book. */
function Side({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return <div className={cn("absolute inset-y-0 w-1/2 shadow-[0_1px_4px_rgba(0,0,0,0.16)]", side === "left" ? "left-0" : "left-1/2")}>{children}</div>;
}

/** The fold down the middle of the open book, shaded on whichever sides have a page. */
function Spine({ left, right }: { left: boolean; right: boolean }) {
  return (
    <>
      {left && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-[44%] w-[6%]"
          style={{ background: "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 55%, rgba(0,0,0,0.26) 100%)" }}
        />
      )}
      {right && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-[5%]"
          style={{ background: "linear-gradient(to right, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.07) 40%, rgba(0,0,0,0) 100%)" }}
        />
      )}
    </>
  );
}

/**
 * The turning leaf. Its front (the page being turned) is clipped to the
 * part still lying flat; its back (the next left-hand page, or blank paper
 * on a phone) is folded over on top, with a soft shadow; the page beneath
 * shows where the leaf has lifted. Drawn by writing styles straight to the
 * DOM each animation frame: no React render per frame.
 */
function Leaf({
  turn,
  wide,
  bookRef,
  onDone,
  front,
  back,
}: {
  turn: Turn;
  wide: boolean;
  bookRef: React.RefObject<HTMLDivElement | null>;
  onDone: (t: Turn) => void;
  front: React.ReactNode;
  back: React.ReactNode;
}) {
  const leaf = useRef<HTMLDivElement>(null);
  const lift = useRef<HTMLDivElement>(null);
  const liftShade = useRef<HTMLDivElement>(null);
  const frontEl = useRef<HTMLDivElement>(null);
  const backEl = useRef<HTMLDivElement>(null);
  const backShade = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const b = bookRef.current;
    const L = leaf.current;
    if (!b || !L) return done.current(turn);
    const BW = b.offsetWidth;
    const H = b.offsetHeight;
    const W = wide ? BW / 2 : BW;
    L.style.left = `${wide ? W : 0}px`;
    L.style.width = `${W}px`;
    L.style.height = `${H}px`;
    backEl.current!.style.width = `${W}px`;
    backEl.current!.style.height = `${H}px`;
    const diag = Math.hypot(W, H);

    const strip = (el: HTMLDivElement, at: Pt, n: Pt, len: number) => {
      const a = Math.atan2(n.y, n.x);
      el.style.width = `${len}px`;
      el.style.height = `${diag * 3}px`;
      el.style.transform = `translate(${at.x}px, ${at.y}px) rotate(${a}rad) translateY(${-diag * 1.5}px)`;
    };

    const draw = (t: number) => {
      const f = curlFrame(easeTurn(t), W, H);
      frontEl.current!.style.clipPath = polygonCss(f.flat);
      lift.current!.style.clipPath = polygonCss(f.lifted);
      strip(liftShade.current!, f.fold.at, f.fold.n, W * (0.08 + 0.22 * f.depth));
      liftShade.current!.style.opacity = `${0.35 + 0.65 * f.depth}`;
      backEl.current!.style.transform = `matrix(${f.backMatrix.map((x) => x.toFixed(4)).join(", ")})`;
      backEl.current!.style.clipPath = polygonCss(f.backClip);
      strip(backShade.current!, f.backFold.at, f.backFold.n, W * 0.55);
    };

    const from = turn.dir > 0 ? 0 : 1;
    const to = 1 - from;
    draw(from);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / TURN_MS);
      draw(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(tick);
      else done.current(turn);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [turn, wide, bookRef]);

  return (
    <div ref={leaf} data-flip-leaf aria-hidden className="pointer-events-none absolute top-0" style={{ left: 0, width: 0, height: 0 }}>
      {/* The shadow the lifted leaf throws on the page beneath. */}
      <div ref={lift} className="absolute inset-0 overflow-hidden">
        <div
          ref={liftShade}
          className="absolute left-0 top-0 origin-top-left"
          style={{ background: "linear-gradient(to right, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.1) 45%, rgba(0,0,0,0) 100%)" }}
        />
      </div>
      <div ref={frontEl} className="absolute inset-0 will-change-[clip-path]">
        {front}
      </div>
      {/* The back of the leaf, folded over the rest. */}
      <div className="absolute inset-0" style={{ filter: "drop-shadow(0 0 10px rgba(0,0,0,0.28))" }}>
        <div ref={backEl} className="absolute left-0 top-0 origin-top-left overflow-hidden will-change-transform">
          {back}
          <div
            ref={backShade}
            className="absolute left-0 top-0 origin-top-left"
            style={{ background: "linear-gradient(to right, rgba(0,0,0,0.22) 0%, rgba(255,255,255,0.18) 18%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.06) 100%)" }}
          />
        </div>
      </div>
    </div>
  );
}
