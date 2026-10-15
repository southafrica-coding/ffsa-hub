"use client";

import { COUNTRY_OPTIONS } from "@/lib/profile/options";

// "Invoice me, pay later": the buyer's country decides which of our two
// organisations invoices them (USA → FF SA USA, Inc; everyone else → Fire &
// Fragrance SA NPC), exactly as students are invoiced in Training. Styled to
// inherit each storefront's type and colour so one picker fits every brand.
export function PayLaterCountry({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "block", margin: "12px 0 8px", font: "inherit", color: "inherit" }}>
      <span style={{ display: "block", fontSize: "0.85em", marginBottom: 6, opacity: 0.85 }}>
        Your country (for the invoice)
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Your country, for the invoice"
        style={{
          width: "100%",
          padding: "10px 12px",
          font: "inherit",
          fontSize: "0.95em",
          color: "inherit",
          background: "transparent",
          border: "1px solid currentColor",
          borderRadius: 0,
        }}
      >
        <option value="">Choose your country…</option>
        {COUNTRY_OPTIONS.map((c) => (
          <option key={c.value} value={c.value} style={{ color: "#111" }}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
