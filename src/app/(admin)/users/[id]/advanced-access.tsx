"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";

export function AdvancedAccess({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--rule)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4"
        style={{ cursor: "pointer", background: "transparent" }}
      >
        <span
          className="flex items-center gap-2"
          style={{ fontSize: "13px", color: "var(--text-tertiary)" }}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Advanced · custom access for this one person
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
        ) : (
          <ChevronRight className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
        )}
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--rule)", padding: "16px 8px" }}>
          {children}
        </div>
      )}
    </div>
  );
}
