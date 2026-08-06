import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  requireAnyModuleAccess,
  hasModuleAccess,
} from "@/lib/require-permission";
import { Building2, Car } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">Bookings</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {bookingTypes.map((b) => {
          const Icon = b.icon;
          const content = (
            <Card className={b.ready ? "card-hover cursor-pointer" : "opacity-50"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-5 w-5" style={{ color: "var(--yellow)" }} />
                  {b.title}
                  {!b.ready && (
                    <span className="ml-auto text-xs font-normal uppercase tracking-widest text-muted-foreground">
                      Soon
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{b.description}</CardDescription>
              </CardHeader>
            </Card>
          );

          if (b.ready) {
            return (
              <Link key={b.title} href={b.href}>
                {content}
              </Link>
            );
          }
          return <div key={b.title}>{content}</div>;
        })}
      </div>
    </div>
  );
}
