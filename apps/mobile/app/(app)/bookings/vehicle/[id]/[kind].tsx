import { useLocalSearchParams, useRouter } from "expo-router";

import { EmptyState } from "@/components";
import { PushedPage } from "@/features/bookings/components/ui";
import { strings } from "@/features/bookings/strings";
import InspectionScreen from "@/features/bookings/screens/InspectionScreen";

// /bookings/vehicle/<id>/collection or /bookings/vehicle/<id>/return
export default function VehicleCheckRoute() {
  const router = useRouter();
  const { id, kind } = useLocalSearchParams<{ id: string; kind: string }>();
  if (kind !== "collection" && kind !== "return") {
    return (
      <PushedPage back={{ label: strings.common.booking, onPress: () => router.back() }}>
        <EmptyState title={strings.detail.checksTitle} body={strings.common.notFound} />
      </PushedPage>
    );
  }
  return <InspectionScreen bookingId={id} kind={kind} />;
}
