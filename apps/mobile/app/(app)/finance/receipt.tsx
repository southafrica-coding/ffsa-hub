import { useLocalSearchParams } from "expo-router";

import ReceiptViewerScreen from "@/features/finance/screens/ReceiptViewerScreen";

export default function ReceiptRoute() {
  const { uri, title } = useLocalSearchParams<{ uri?: string; title?: string }>();
  return <ReceiptViewerScreen uri={uri} title={title} />;
}
