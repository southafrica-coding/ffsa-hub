// PLACEHOLDER: replaced by slice 3
// Slice 3 overwrites this exact file (and adds app/(app)/tickets/_layout.tsx).
// On the add/add merge conflict, take slice 3's version.
import { Masthead, Screen, Text } from "@/components";

export default function TicketsComingSoon() {
  return (
    <Screen edges={["top"]}>
      <Masthead context="FFSA Hub · Tickets" title="Tickets" />
      <Text tone="secondary">{"Coming soon. Until it's ready, use the FFSA Hub website."}</Text>
    </Screen>
  );
}
