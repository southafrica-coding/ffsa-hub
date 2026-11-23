// The bookings hub: what there is to book, and nothing else. Each type is its
// own module with its own permission, its own screens and its own shape —
// spaces are a timetable, vehicles are a rental process, equipment is an asset
// register with a hire shop on top — so this page routes
// rather than visualising. Only the types the viewer can actually open are
// listed; a card that would just redirect them out is worse than no card.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  requireAnyModuleAccess,
  hasModuleAccess,
} from "@/lib/require-permission";
import { Building2, Car, Package, Speaker, ArrowUpRight } from "lucide-react";
import { Masthead } from "@/components/ffsa";

// module null = open to everyone signed in (the borrow form checks the rest).
const BOOKING_TYPES: {
  title: string;
  description: string;
  href: string;
  icon: typeof Building2;
  module: string | null;
  shape: string;
}[] = [
  {
    title: "Space Bookings",
    description:
      "See the day across every venue, spot a clash, and request or approve a space — with the month, week and list views behind it.",
    href: "/bookings/spaces",
    icon: Building2,
    module: "bookings",
    shape: "Day timeline",
  },
  {
    title: "Rent a Vehicle",
    description:
      "Request a base vehicle for outreach, airport runs and ministry trips — fleet, drivers, collection and return, and approvals.",
    href: "/bookings/vehicles",
    icon: Car,
    module: "vehicles",
    shape: "Rental process",
  },
  {
    title: "Equipment",
    description:
      "Everything we own: sound and stage gear by tag, counted items like glasses and tablecloths, and consumables. Add items, approve requests.",
    href: "/bookings/equipment",
    icon: Speaker,
    module: "equipment",
    shape: "Asset register",
  },
  {
    title: "Borrow equipment",
    description:
      "Ask to borrow glasses, tablecloths, lights, décor and gear for a school or ministry. The inventory manager approves it.",
    href: "/bookings/borrow",
    icon: Package,
    module: null,
    shape: "Request",
  },
];

export default async function BookingsHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireAnyModuleAccess(supabase, user.id, ["bookings", "vehicles", "equipment"]);

  // Each type is asked for independently, on the same module access that gates
  // the screens behind it.
  const access = await Promise.all(
    BOOKING_TYPES.map((b) => (b.module ? hasModuleAccess(supabase, user.id, b.module) : true))
  );
  const bookingTypes = BOOKING_TYPES.filter((_, i) => access[i]);

  return (
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="Bookings" />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <div className="border border-ink bg-white">
          {bookingTypes.map((b) => {
            const Icon = b.icon;
            return (
              <Link
                key={b.title}
                href={b.href}
                className="block border-b border-rule last:border-b-0 hover:bg-bone"
              >
                <div className="flex items-start gap-4 px-6 py-6">
                  <Icon className="mt-1 h-5 w-5 shrink-0 text-[color:var(--text-tertiary)]" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[22px]">{b.title}</h2>
                    <p className="mt-1.5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
                      {b.description}
                    </p>
                    {/* Says what shape the module is, so the two are not
                        mistaken for the same kind of screen. */}
                    <span className="mono-label mt-3 inline-block">{b.shape}</span>
                  </div>
                  <span className="mono-label flex shrink-0 items-center gap-1 pt-1">
                    Open <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
