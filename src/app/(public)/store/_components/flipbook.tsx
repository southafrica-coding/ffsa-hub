"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type FlipPage = { n: number; w: number; h: number; url: string };

// A plain, fast flipbook: one page on phones, a two-page spread from md
// (cover alone on the right, like a printed magazine). Swipe, tap the
// edges, or use the arrow keys. Images load lazily; the next spread is
// prefetched. No download control — pages are images stamped server-side.
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
  const [index, setIndex] = useState(0);
  const [wide, setWide] = useState(false);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const set = () => setWide(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  const spreads: number[][] = useMemo(() => buildSpreads(pages, wide), [wide, pages]);
  const spreadIndex = Math.max(0, spreads.findIndex((s) => s.includes(index)));
  const spread = spreads[spreadIndex] ?? [0];

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = spreads[spreadIndex + dir];
      if (next) setIndex(next[0]);
    },
    [spreads, spreadIndex]
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go]);

  // Prefetch the next spread.
  useEffect(() => {
    for (const i of spreads[spreadIndex + 1] ?? []) {
      const img = new window.Image();
      img.src = pages[i].url;
    }
  }, [spreadIndex, spreads, pages]);

  if (pages.length === 0) return null;
  const label = spread.map((i) => pages[i].n).join("–");

  return (
    <div className={cn("select-none", className)}>
      <div
        className="relative flex items-center justify-center bg-bone-2 px-2 py-4 md:px-12 md:py-8"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className={cn("flex w-full justify-center", spread.length === 1 && wide && spread[0] === 0 && !isLandscape(pages[0]) && "md:pl-[50%]")}>
          {spread.map((i) => (
            <div
              key={pages[i].n}
              className={cn(
                "relative w-full animate-fade-up border border-rule bg-white",
                isLandscape(pages[i]) ? "max-w-[min(100%,1120px)]" : "max-w-[min(100%,560px)]"
              )}
              style={{ aspectRatio: `${pages[i].w / pages[i].h}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pages[i].url}
                alt={`Page ${pages[i].n}`}
                draggable={false}
                loading={i <= 2 ? "eager" : "lazy"}
                className="pointer-events-none h-full w-full object-contain"
                onError={() => onNeedRefresh?.()}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => go(-1)}
          disabled={spreadIndex === 0}
          className="absolute inset-y-0 left-0 flex w-1/4 items-center justify-start pl-1 text-ink opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 md:w-12 md:justify-center md:pl-0"
        >
          <span className="flex h-11 w-11 items-center justify-center border border-ink bg-white"><ChevronLeft className="h-5 w-5" /></span>
        </button>
        <button
          type="button"
          aria-label="Next page"
          onClick={() => go(1)}
          disabled={spreadIndex >= spreads.length - 1}
          className="absolute inset-y-0 right-0 flex w-1/4 items-center justify-end pr-1 text-ink opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 md:w-12 md:justify-center md:pr-0"
        >
          <span className="flex h-11 w-11 items-center justify-center border border-ink bg-white"><ChevronRight className="h-5 w-5" /></span>
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
 * Which pages show together. Phones: one page at a time. Wide screens: the
 * cover alone, then facing pairs like a printed magazine, except that a
 * landscape page (a spread already saved as one PDF page) always shows on
 * its own, and so does a portrait page whose neighbour is landscape.
 */
export function buildSpreads(pages: Pick<FlipPage, "w" | "h">[], wide: boolean): number[][] {
  if (!wide) return pages.map((_, i) => [i]);
  const out: number[][] = [];
  for (let i = 0; i < pages.length; ) {
    if (i === 0 || isLandscape(pages[i]) || i + 1 >= pages.length || isLandscape(pages[i + 1])) {
      out.push([i]);
      i += 1;
    } else {
      out.push([i, i + 1]);
      i += 2;
    }
  }
  return out;
}
