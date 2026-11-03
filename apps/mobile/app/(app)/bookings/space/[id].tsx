import { useLocalSearchParams } from "expo-router";

import SpaceDetailScreen from "@/features/bookings/screens/SpaceDetailScreen";

export default function SpaceBookingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SpaceDetailScreen id={id} />;
}
