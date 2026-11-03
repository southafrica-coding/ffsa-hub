import { useLocalSearchParams } from "expo-router";

import EnrolmentScreen from "@/features/schools/screens/EnrolmentScreen";

export default function EnrolmentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EnrolmentScreen id={id} />;
}
