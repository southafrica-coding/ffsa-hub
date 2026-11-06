import { useLocalSearchParams } from "expo-router";

import { StaffDecisionsGate } from "@/features/staff-decisions/screens/StaffDecisionsGate";
import SchoolDetailScreen from "@/features/staff-decisions/screens/SchoolDetailScreen";

export default function StaffDecisionSchoolRoute() {
  const { programId } = useLocalSearchParams<{ programId: string }>();
  return (
    <StaffDecisionsGate>
      <SchoolDetailScreen programId={programId} />
    </StaffDecisionsGate>
  );
}
