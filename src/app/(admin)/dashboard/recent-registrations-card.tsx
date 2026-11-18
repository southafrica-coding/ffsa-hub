import { WidgetShell, WidgetEmpty } from "./widget-shell";
import { StatusPill, Initials } from "@/components/ffsa";

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
    <WidgetShell title="Recent registrations">
      <div className="py-2">
        {registrations.length === 0 ? (
          <WidgetEmpty>No registrations yet.</WidgetEmpty>
        ) : (
          registrations.map((reg) => {
            const contact = Array.isArray(reg.contacts) ? reg.contacts[0] : reg.contacts;
            const event = Array.isArray(reg.events) ? reg.events[0] : reg.events;
            const name = contact
              ? `${contact.preferred_name ?? contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()
              : "";
            return (
              <div
                key={reg.id}
                className="flex items-center justify-between gap-4 border-b border-[color:var(--surface-4)] px-6 py-3 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Initials name={name || "—"} size={30} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--text-primary)]">
                      {name || "—"}
                    </p>
                    <p className="mt-1 truncate text-[13px] text-[color:var(--text-tertiary)]">
                      {event?.title ?? "—"}
                    </p>
                  </div>
                </div>
                <StatusPill
                  tone={
                    reg.status === "confirmed"
                      ? "good"
                      : reg.status === "pending"
                        ? "warn"
                        : "quiet"
                  }
                >
                  {reg.status.charAt(0).toUpperCase() + reg.status.slice(1)}
                </StatusPill>
              </div>
            );
          })
        )}
      </div>
    </WidgetShell>
  );
}
