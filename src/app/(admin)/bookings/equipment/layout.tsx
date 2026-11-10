// Every /bookings/equipment page: gated by has_equipment_access(), dark
// (.theme-hire), with the Hire panel on desktop and the hire tab bar on
// phones. Spec: handoff/19-equipment-hire.md.

import { Bebas_Neue } from "next/font/google";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasEquipmentAccess } from "@/services/equipment";
import { HIRE_CSS } from "@/lib/equipment/hire-theme";
import { HirePanel, HireTabBar } from "./hire-nav";

const hireDisplay = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas",
});

export default async function EquipmentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The same check the RLS policies use, so the page and the data agree.
  if (!(await hasEquipmentAccess(supabase))) redirect("/bookings");

  return (
    <div className={`theme-hire flex min-h-[calc(100dvh-3.5rem)] md:min-h-screen ${hireDisplay.variable}`}>
      <style dangerouslySetInnerHTML={{ __html: HIRE_CSS }} />
      <HirePanel />
      <div className="min-w-0 flex-1">{children}</div>
      <HireTabBar />
    </div>
  );
}
