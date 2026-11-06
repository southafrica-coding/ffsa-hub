import { useLocalSearchParams } from "expo-router";

import OwnerScreen from "@/features/okrs/screens/OwnerScreen";

export default function OkrOwnerRoute() {
  const { ownerId, cycle } = useLocalSearchParams<{ ownerId: string; cycle?: string }>();
  const slug = typeof cycle === "string" && cycle ? cycle : null;
  return <OwnerScreen key={`${ownerId}:${slug ?? "current"}`} ownerId={ownerId} cycle={slug} />;
}
