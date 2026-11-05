import { useLocalSearchParams } from "expo-router";

import EnrolmentScreen from "@/features/schools/screens/EnrolmentScreen";
import { SchoolsGate } from "@/features/schools/screens/SchoolsGate";

export default function EnrolmentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SchoolsGate>
      <EnrolmentScreen id={id} />
    </SchoolsGate>
  );
}
