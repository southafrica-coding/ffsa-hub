import { useLocalSearchParams } from "expo-router";

import { TicketDetailScreen } from "@/features/tickets/screens/TicketDetailScreen";

export default function TicketRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TicketDetailScreen ticketId={String(id ?? "")} />;
}
