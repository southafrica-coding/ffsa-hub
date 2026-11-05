import { SchoolsGate } from "@/features/schools/screens/SchoolsGate";
import SchoolsListScreen from "@/features/schools/screens/SchoolsListScreen";

export default function SchoolsRoute() {
  return (
    <SchoolsGate>
      <SchoolsListScreen />
    </SchoolsGate>
  );
}
