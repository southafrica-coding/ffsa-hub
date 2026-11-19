import { useLocalSearchParams, useRouter } from "expo-router";

import { TicketDetailScreen } from "@/features/tickets/screens/TicketDetailScreen";

export default function TicketRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Opened from a link there may be nothing behind it: land on My tickets.
  return <TicketDetailScreen ticketId={String(id ?? "")} onBack={() => (router.canGoBack() ? router.back() : router.replace("/tickets"))} />;
}
