import { useLocalSearchParams } from "expo-router";

import StudentScreen from "@/features/training/screens/StudentScreen";

export default function TrainingStudentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StudentScreen id={id} />;
}
