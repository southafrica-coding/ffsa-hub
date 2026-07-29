"use client";

// Horizontal proportion bar. Segments with a zero count are skipped so the
// bar never renders slivers that can't be read.
export function StackedBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div
      className="flex"
      style={{
        height: "8px",
        borderRadius: "4px",
        overflow: "hidden",
        background: "hsl(22 8% 13%)",
      }}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.color,
            }}
          />
        ))}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  return (
    <div className="flex flex-wrap" style={{ gap: "0.75rem", marginTop: "0.5rem" }}>
      {items.map((i) => (
        <div key={i.label} className="flex items-center" style={{ gap: "5px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "2px",
              background: i.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "10px", color: "hsl(30 8% 50%)" }}>
            {i.label}
          </span>
          <span style={{ fontSize: "10px", color: "#F0EBE3", fontWeight: 600 }}>
            {i.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export const TIER_COLORS = {
  A: "hsl(42 95% 55%)",
  B: "hsl(200 60% 52%)",
  C: "hsl(160 50% 45%)",
  unknown: "hsl(22 8% 28%)",
};

export const GENDER_COLORS: Record<string, string> = {
  male: "hsl(200 60% 52%)",
  female: "hsl(330 65% 60%)",
  prefer_not_to_say: "hsl(42 95% 55%)",
  unknown: "hsl(22 8% 28%)",
};

export function genderLabel(key: string): string {
  if (key === "male") return "Male";
  if (key === "female") return "Female";
  if (key === "prefer_not_to_say") return "Prefer not to say";
  if (key === "unknown") return "Not recorded";
  // Legacy free-text values from before the profile dropdown existed.
  return key.charAt(0).toUpperCase() + key.slice(1);
}
