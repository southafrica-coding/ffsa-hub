import { WidgetShell, WidgetEmpty } from "./widget-shell";

type ContactLite = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

export type RegistrationRow = {
  id: string;
  status: string;
  registered_at: string;
  contacts: ContactLite | ContactLite[] | null;
  events: { title: string } | { title: string }[] | null;
};

// Extracted from the old inline dashboard markup. The array-or-object
// normalisation on the joins is preserved from the original — supabase-js
// infers the relationship shape inconsistently here.
export function RecentRegistrationsCard({
  registrations,
}: {
  registrations: RegistrationRow[];
}) {
  return (
    <WidgetShell title="Recent Registrations">
      <div style={{ padding: "0.5rem 0" }}>
        {registrations.length === 0 ? (
          <WidgetEmpty>No recent registrations</WidgetEmpty>
        ) : (
          registrations.map((reg) => {
            const contact = Array.isArray(reg.contacts) ? reg.contacts[0] : reg.contacts;
            const event = Array.isArray(reg.events) ? reg.events[0] : reg.events;
            return (
              <div
                key={reg.id}
                className="flex items-center justify-between"
                style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid hsl(22 8% 11%)" }}
              >
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3" }}>
                    {contact
                      ? `${contact.preferred_name ?? contact.first_name} ${contact.last_name}`
                      : "—"}
                  </p>
                  <p style={{ fontSize: "11px", color: "hsl(30 8% 42%)", marginTop: "2px" }}>
                    {event?.title ?? "—"}
                  </p>
                </div>
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: "0.15em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    background:
                      reg.status === "confirmed"
                        ? "hsl(142 60% 20%)"
                        : reg.status === "pending"
                        ? "hsl(42 80% 18%)"
                        : "hsl(22 8% 15%)",
                    color:
                      reg.status === "confirmed"
                        ? "hsl(142 60% 55%)"
                        : reg.status === "pending"
                        ? "hsl(42 95% 55%)"
                        : "hsl(30 8% 55%)",
                  }}
                >
                  {reg.status}
                </span>
              </div>
            );
          })
        )}
      </div>
    </WidgetShell>
  );
}
