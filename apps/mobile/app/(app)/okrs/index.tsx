import { useLocalSearchParams } from "expo-router";

import WallScreen from "@/features/okrs/screens/WallScreen";

export default function OkrWallRoute() {
  const { cycle } = useLocalSearchParams<{ cycle?: string }>();
  const slug = typeof cycle === "string" && cycle ? cycle : null;
  // Keyed by cycle, so switching starts clean instead of showing the last cycle's data.
  return <WallScreen key={slug ?? "current"} cycle={slug} />;
}
