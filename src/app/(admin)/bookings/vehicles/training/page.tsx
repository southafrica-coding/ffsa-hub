import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { Button } from "@/components/ui/button";
import { Masthead } from "@/components/ffsa";
import { scriptSteps, CAST } from "@/lib/vehicles/training/script";
import { TrainingView } from "./training-view";

/**
 * Training: how a vehicle booking works, from the form to completed, on made-up people
 * (Gideon, 24 Nov 2026: train ministries and staff, and show the coordinator's part).
 * Nothing on this page reads or writes a real booking, and nothing is sent.
 */
export default async function VehicleTrainingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "vehicles");

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Rent a Vehicle · Training"
        title="How a vehicle booking works"
        actions={
          <Link href="/bookings/vehicles">
            <Button size="sm" variant="outline" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Rent a Vehicle
            </Button>
          </Link>
        }
      />
      <TrainingView steps={scriptSteps()} cast={CAST} />
    </div>
  );
}
