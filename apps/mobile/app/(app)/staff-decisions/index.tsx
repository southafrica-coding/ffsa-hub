import { StaffDecisionsGate } from "@/features/staff-decisions/screens/StaffDecisionsGate";
import SchoolsListScreen from "@/features/staff-decisions/screens/SchoolsListScreen";

export default function StaffDecisionsRoute() {
  return (
    <StaffDecisionsGate>
      <SchoolsListScreen />
    </StaffDecisionsGate>
  );
}
