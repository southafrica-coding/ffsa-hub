import { useLocalSearchParams } from "expo-router";

import VehicleDetailScreen from "@/features/bookings/screens/VehicleDetailScreen";

export default function VehicleBookingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VehicleDetailScreen id={id} />;
}
