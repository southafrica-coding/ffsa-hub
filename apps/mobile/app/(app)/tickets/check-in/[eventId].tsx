import { useLocalSearchParams } from "expo-router";

import { DoorScreen } from "@/features/tickets/screens/DoorScreen";

export default function DoorRoute() {
  const { eventId, title } = useLocalSearchParams<{ eventId: string; title?: string }>();
  return <DoorScreen eventId={String(eventId ?? "")} eventTitle={title ? String(title) : undefined} />;
}
