import { Users, Calendar, UserCheck, ClipboardCheck } from "lucide-react";

// Extracted verbatim from the old inline dashboard markup so the widget
// renders identically to before the registry existed.
function StatCard({
  label,
  value,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: boolean;
}) {
  return (
    <div
      className="card-hover"
      style={{
        background: accent ? "hsl(42 95% 55% / 0.06)" : "hsl(22 10% 8%)",
        border: accent ? "1px solid hsl(42 95% 55% / 0.25)" : "1px solid hsl(22 8% 14%)",
        borderRadius: "14px",
        padding: "1.5rem",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Glow behind number for accented card */}
      {accent && (
        <div
          style={{
            position: "absolute",
            bottom: "-20px",
            left: "1.5rem",
            width: "60px",
            height: "60px",
            background: "hsl(42 95% 55% / 0.12)",
            borderRadius: "50%",
            filter: "blur(20px)",
            pointerEvents: "none",
          }}
        />
      )}

      <div className="flex items-start justify-between mb-3">
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.22em",
            fontWeight: 700,
            color: accent ? "hsl(42 95% 65%)" : "hsl(30 8% 42%)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </p>
        <div
          style={{
            background: accent ? "hsl(42 95% 55% / 0.15)" : "hsl(22 8% 13%)",
            borderRadius: "8px",
            padding: "6px",
            color: accent ? "hsl(42 95% 55%)" : "hsl(30 8% 45%)",
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <p
        style={{
          fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
          fontSize: "3.75rem",
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: accent ? "hsl(42 95% 58%)" : "#F0EBE3",
        }}
      >
        {value}
      </p>
    </div>
  );
}

export function StatCards({
  contacts,
  events,
  users,
  recentRegistrations,
}: {
  contacts: number;
  events: number;
  users: number;
  recentRegistrations: number;
}) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <StatCard label="Active Contacts" value={contacts} icon={Users} accent />
      <StatCard label="Published Events" value={events} icon={Calendar} />
      <StatCard label="Active Users" value={users} icon={UserCheck} />
      <StatCard label="Recent Reg." value={recentRegistrations} icon={ClipboardCheck} />
    </div>
  );
}
