import { UserCheck } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";

import { Masthead, Screen } from "@/components";
import { Skeleton } from "@/features/finance/components/ui";
import { StateMessage } from "@/features/shell";

import { useStaffDecisionsAccess } from "../access";
import { strings } from "../strings";

const s = strings.gate;

// The /staff-decisions routes can be reached without the Home shortcut (a
// feed item, a link), so they ask the same question Home does. UX only: the
// endpoints check again. When /api/me couldn't be read at all, the screen is
// shown; it has its own error and no-access states from the server's answer.
export function StaffDecisionsGate({ children }: { children: ReactNode }) {
  const access = useStaffDecisionsAccess();
  if (access === "checking") {
    return (
      <GateFrame>
        <Skeleton label={s.checking} />
      </GateFrame>
    );
  }
  if (access === "notAllowed") {
    return (
      <GateFrame>
        <StateMessage testID="staff-decisions-not-allowed" icon={UserCheck} title={s.title} body={s.body} />
      </GateFrame>
    );
  }
  return <>{children}</>;
}

function GateFrame({ children }: { children: ReactNode }) {
  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}>
        <Masthead context={strings.list.context} title={strings.list.title} />
        {children}
      </ScrollView>
    </Screen>
  );
}
