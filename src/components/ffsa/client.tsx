"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Client-only design primitives. The server barrel at @/components/ffsa
 * re-exports Drawer so existing imports keep working, and this file is the
 * direct entry when a page should not pull the whole set.
 */
export function Drawer({
  open,
  onClose,
  label,
  onPrev,
  onNext,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  onPrev?: () => void;
  onNext?: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowUp" && onPrev) onPrev();
      if (event.key === "ArrowDown" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onPrev, onNext]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,10,10,0.22)]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={label}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-ink bg-white sm:w-[470px]"
      >
        <div className="flex shrink-0 items-center justify-between bg-ink px-6 py-3.5">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-yellow">
            {label}
          </span>
          <div className="flex items-center gap-4 font-mono text-[10px] font-bold tracking-[0.12em] text-[#8E8A7C]">
            {onPrev && (
              <button type="button" onClick={onPrev} className="hover:text-white">
                ↑ PREV
              </button>
            )}
            {onNext && (
              <button type="button" onClick={onNext} className="hover:text-white">
                NEXT ↓
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center text-[16px] text-white">
              ✕
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </aside>
    </>,
    document.body
  );
}
