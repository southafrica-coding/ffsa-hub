function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function CheckIcon() {
  return (
    <Svg size={14}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function DoubleCheckIcon() {
  return (
    <Svg size={14}>
      <path d="M17 7 7.5 16.5 4 13" />
      <path d="m22 7-9.5 9.5-1.5-1.5" />
    </Svg>
  );
}

export function ClockIcon() {
  return (
    <Svg size={14}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function WarnIcon() {
  return (
    <Svg size={14}>
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function ChevronIcon() {
  return (
    <Svg size={14}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function SendIcon() {
  return (
    <Svg size={18}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </Svg>
  );
}

/** A speech bubble, not WhatsApp's trademark logo. */
export function WhatsAppGlyph() {
  return (
    <Svg size={18}>
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z" />
    </Svg>
  );
}
