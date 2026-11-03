import { useLocalSearchParams } from "expo-router";

import TeamScreen from "@/features/finance/screens/TeamScreen";

export default function TeamRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  return <TeamScreen teamId={teamId} />;
}
