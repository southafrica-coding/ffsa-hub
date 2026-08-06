"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Full-screen blocking overlay for the profile / children / consent gates.
//
// It is portalled to document.body on purpose: the gates are mounted deep
// inside the app layout, under a `max-w-6xl` container that has a CSS
// transform (animate-fade-up). A `position: fixed` element is positioned
// relative to the nearest transformed ancestor, so without the portal the
// overlay was trapped inside the centre content column — leaving the sidebar
// visible and only covering "half the page". Portalling to <body> escapes
// that ancestor so the overlay covers the entire viewport in solid black.
export function GateOverlay({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    // data-blocking-gate lets AutoRefresh pause while a gate is on screen —
    // otherwise its 10s router.refresh() re-runs the gate and can auto-advance
    // the user mid-flow (e.g. jumping to consent while they add a 2nd child).
    <div
      data-blocking-gate="true"
      className="fixed inset-0 z-[100] overflow-y-auto bg-black"
    >
      <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
        {children}
      </div>
    </div>,
    document.body
  );
}
