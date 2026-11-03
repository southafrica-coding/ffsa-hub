import { useLocalSearchParams } from "expo-router";

import { StateMessage } from "@/features/shell";
import { strings } from "@/features/bookings/strings";
import InspectionScreen from "@/features/bookings/screens/InspectionScreen";

// /bookings/vehicle/<id>/collection or /bookings/vehicle/<id>/return
export default function VehicleCheckRoute() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: string }>();
  if (kind !== "collection" && kind !== "return") {
    return <StateMessage title={strings.detail.checksTitle} body={strings.common.notFound} />;
  }
  return <InspectionScreen bookingId={id} kind={kind} />;
}
