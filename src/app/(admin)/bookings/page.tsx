import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
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
  },
  {
    title: "Rent a Vehicle",
    description:
      "Reserve an FFSA vehicle for ministry trips and errands.",
    href: "/bookings/vehicles",
    icon: Car,
    ready: false,
  },
];

export default async function BookingsHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "bookings");

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">Bookings</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {BOOKING_TYPES.map((b) => {
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
