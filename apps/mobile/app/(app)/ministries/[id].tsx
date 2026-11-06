import { useLocalSearchParams } from "expo-router";

import { MinistriesGate } from "@/features/ministries/screens/MinistriesGate";
import MinistryDetailScreen from "@/features/ministries/screens/MinistryDetailScreen";

export default function MinistryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <MinistriesGate>
      <MinistryDetailScreen id={id} />
    </MinistriesGate>
  );
}
