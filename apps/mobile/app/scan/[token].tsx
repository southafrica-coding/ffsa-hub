import { useLocalSearchParams } from "expo-router";

import { PublicScanScreen } from "@/features/public-scan/screens/PublicScanScreen";

// https://www.ffsahub.com/scan/<token> and ffsahub://scan/<token>.
// Keyed on the token: a second link opened over the first starts a fresh
// door (its own check, tally and offline queue), never the old one's.
export default function ScanRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <PublicScanScreen key={String(token ?? "")} token={token} />;
}
