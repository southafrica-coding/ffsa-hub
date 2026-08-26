"use client";

import { useEffect, useRef } from "react";

/**
 * The six-digit authenticator field.
 *
 * One input rather than six boxes: paste of a full code works everywhere
 * without special handling, password managers and iOS SMS-style autofill can
 * fill it via autoComplete="one-time-code", and backspace behaves the way
 * people expect. Non-digits are stripped as you type, so a pasted code with
 * stray spaces still lands correctly.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus = true,
  id = "code",
  variant = "light",
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  /** "light" for the editorial sign-in shell, "dark" for the account pages. */
  variant?: "light" | "dark";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === 6 && firedFor.current !== value) {
      firedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < 6) firedFor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      ref={ref}
      id={id}
      name="one-time-code"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      spellCheck={false}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="······"
      aria-label="Six-digit authentication code"
      style={{
        width: "100%",
        height: "60px",
        borderRadius: variant === "dark" ? "10px" : "2px",
        background: variant === "dark" ? "hsl(20 12% 5%)" : "#FFFFFF",
        border:
          variant === "dark"
            ? "1px solid hsl(22 8% 17%)"
            : "1px solid var(--rule, #DCD8CF)",
        color: variant === "dark" ? "#F0EBE3" : "var(--ink, #111111)",
        fontSize: "28px",
        fontWeight: 600,
        letterSpacing: "0.5em",
        textIndent: "0.5em",
        textAlign: "center",
        fontVariantNumeric: "tabular-nums",
        opacity: disabled ? 0.6 : 1,
        outline: "none",
      }}
    />
  );
}
