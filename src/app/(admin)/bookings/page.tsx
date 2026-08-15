import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  requireAnyModuleAccess,
  hasModuleAccess,
} from "@/lib/require-permission";
import { Building2, Car, ArrowUpRight } from "lucide-react";
import { Masthead } from "@/components/ffsa";

const BOOKING_TYPES = [
  {
    title: "Space Bookings",
    description:
      "Request and approve venue & space bookings across FFSA — calendar, recurring slots, and approvals.",
    href: "/bookings/spaces",
    icon: Building2,
    ready: true,
    module: "bookings",
  },
  {
    title: "Rent a Vehicle",
    description:
      "Request a base vehicle for outreach, airport runs, and ministry trips — fleet, drivers, and approvals.",
    href: "/bookings/vehicles",
    icon: Car,
    ready: true,
    module: "vehicles",
  },
];

export default async function BookingsHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireAnyModuleAccess(supabase, user.id, ["bookings", "vehicles"]);

  // Only surface the booking types the user can actually open — Space Bookings
  // is restricted to ministry leaders / booking-admin roles, so vehicle-only
  // staff shouldn't see a card that would just redirect them out.
  const access = await Promise.all(
    BOOKING_TYPES.map((b) => hasModuleAccess(supabase, user.id, b.module))
  );
  const bookingTypes = BOOKING_TYPES.filter((_, i) => access[i]);

  return (
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="Bookings" />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <div className="border border-ink">
          {bookingTypes.map((b) => {
            const Icon = b.icon;
            const body = (
              <div className="flex items-start gap-4 border-b border-rule px-6 py-6 last:border-b-0">
                <Icon className="mt-1 h-5 w-5 shrink-0 text-[color:var(--text-tertiary)]" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[22px]">{b.title}</h2>
                  <p className="mt-1.5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
                    {b.description}
                  </p>
                </div>
                {b.ready ? (
                  <span className="mono-label flex shrink-0 items-center gap-1 pt-1">
                    Open <ArrowUpRight className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="mono-label shrink-0 pt-1">Soon</span>
                )}
              </div>
            );

            if (b.ready) {
              return (
                <Link
                  key={b.title}
                  href={b.href}
                  className="block transition-colors hover:bg-bone"
                >
                  {body}
                </Link>
              );
            }
            return (
              <div key={b.title} className="opacity-50">
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
