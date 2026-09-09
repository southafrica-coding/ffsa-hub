/**
 * Single source of truth for rendering a user's avatar.
 * Renders the uploaded image when `src` is set; otherwise falls back
 * to the gold-circle-with-initial that was used everywhere before.
 *
 * Pass the most-display-worthy name available (first_name
 * → email) — the first non-whitespace character becomes the initial.
 */
export function UserAvatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = ((name ?? "?").trim().charAt(0) || "?").toUpperCase();
  const fontSize = Math.max(10, Math.round(size * 0.42));
  const borderWidth = size <= 28 ? 0 : 1;

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
  };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "User avatar"}
        className={`shrink-0 object-cover ${className ?? ""}`}
        style={{
          ...baseStyle,
          border: borderWidth ? "1px solid var(--rule-strong)" : "none",
          background: "var(--surface-3)",
        }}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center shrink-0 font-bold ${className ?? ""}`}
      style={{
        ...baseStyle,
        background: "hsl(42 95% 55% / 0.12)",
        border: borderWidth
          ? "1px solid hsl(42 95% 55% / 0.3)"
          : "none",
        color: "hsl(42 95% 65%)",
        fontSize,
        lineHeight: 1,
      }}
      aria-label={name ?? "User avatar"}
    >
      {initial}
    </div>
  );
}
