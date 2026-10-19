import { redirect } from "next/navigation";

// The dashboard (frame 47c) comes with the warehouse stage. Until then the
// module opens on the register.
export default function EquipmentPage() {
  redirect("/bookings/equipment/gear");
}
