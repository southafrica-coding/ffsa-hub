import { useRouter } from "expo-router";
import { UserCheck } from "lucide-react-native";

import { ListRow } from "@/features/shell";

import { useStaffDecisionsAccess } from "./access";
import { strings } from "./strings";

/**
 * Home's "Staff decisions" row, shown only to the Leadership Team (role-only:
 * admin alone doesn't see it). Self-contained so Home needs one line.
 */
export function StaffDecisionsHomeShortcut() {
  const router = useRouter();
  if (useStaffDecisionsAccess() !== "allowed") return null;
  return (
    <ListRow
      icon={UserCheck}
      title={strings.shortcut.title}
      subtitle={strings.shortcut.subtitle}
      onPress={() => router.navigate("/staff-decisions")}
      testID="shortcut-staff-decisions"
    />
  );
}
