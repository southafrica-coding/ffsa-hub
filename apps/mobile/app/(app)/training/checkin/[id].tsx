import { useLocalSearchParams } from "expo-router";

import CheckInScreen from "@/features/training/screens/CheckInScreen";

export default function TrainingCheckInRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <CheckInScreen id={id} name={name ?? ""} />;
}
