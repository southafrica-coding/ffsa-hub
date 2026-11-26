import { useLocalSearchParams, useRouter } from "expo-router";

import { DoorScreen } from "@/features/tickets/screens/DoorScreen";
import { strings } from "@/features/tickets/strings";

export default function DoorRoute() {
  const { eventId, title } = useLocalSearchParams<{ eventId: string; title?: string }>();
  const router = useRouter();
  return (
    <DoorScreen
      eventId={String(eventId ?? "")}
      eventTitle={title ? String(title) : undefined}
      back={{ label: strings.checkIn.listTitle, onPress: () => (router.canGoBack() ? router.back() : router.replace("/tickets/check-in")) }}
    />
  );
}
