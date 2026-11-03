// PLACEHOLDER: replaced by slice 2
// Slice 2 overwrites this exact file (and adds app/(app)/finance/_layout.tsx).
// On the add/add merge conflict, take slice 2's version.
import { Masthead, Screen, Text } from "@/components";

export default function FinanceComingSoon() {
  return (
    <Screen edges={["top"]}>
      <Masthead context="FFSA Hub · Finance" title="Finance" />
      <Text tone="secondary">{"Coming soon. Until it's ready, use the FFSA Hub website."}</Text>
    </Screen>
  );
}
