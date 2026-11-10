"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { FFSA_SWATCHES } from "@/lib/brand/ffsa";

// Click a swatch to copy its hex. These are the same constants every FFSA
// email and public page renders from — copying one here gives you the
// exact value in use, not a value someone re-typed from the deck.

export function SwatchGrid() {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1400);
    } catch {
      // Clipboard blocked (insecure context / permission) — the hex is
      // printed under every swatch, so it stays selectable by hand.
    }
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {FFSA_SWATCHES.map((s) => {
        const isCopied = copied === s.hex;
        return (
          <button
            key={s.hex}
            type="button"
            onClick={() => copy(s.hex)}
            className="group text-left"
            title={`Copy ${s.hex}`}
          >
            <div
              className="w-full aspect-square rounded-xl mb-2 flex items-start justify-end p-2 transition-transform group-hover:scale-[1.02]"
              style={{
                background: s.hex,
                border: "1px solid var(--surface-4)",
              }}
            >
              {isCopied ? (
                <Check
                  className="h-4 w-4"
                  style={{ color: s.hex === "#FFFFFF" ? "#000" : "#fff" }}
                />
              ) : (
                <Copy
                  className="h-4 w-4 opacity-0 group-hover:opacity-70 transition-opacity"
                  style={{ color: s.hex === "#FFFFFF" ? "#000" : "#fff" }}
                />
              )}
            </div>
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-primary)" }}
            >
              {s.name}
            </p>
            <p
              className="text-[11px] mt-0.5"
              style={{
                fontFamily: "var(--font-roboto-mono, ui-monospace, monospace)",
                color: isCopied ? "var(--yellow)" : "var(--text-secondary)",
              }}
            >
              {isCopied ? "Copied" : s.hex}
            </p>
            <p
              className="text-[11px] leading-snug mt-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              {s.role}
            </p>
          </button>
        );
      })}
    </div>
  );
}
