import { useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import type { ReactNode } from "react";

import { Bleed, EmptyState, LargeTitleScrollView, SkeletonList } from "@/components";

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
        <SkeletonList label={s.checking} count={3} inset={false} />
      </GateFrame>
    );
  }
  if (access === "notAllowed") {
    return (
      <GateFrame>
        <EmptyState testID="staff-decisions-not-allowed" icon={Lock} title={s.title} body={s.body} />
      </GateFrame>
    );
  }
  return <>{children}</>;
}

function GateFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <LargeTitleScrollView
      back={{ label: strings.common.home, onPress: () => router.navigate("/") }}
      eyebrow={strings.list.context}
      title={strings.list.title}
    >
      <Bleed>{children}</Bleed>
    </LargeTitleScrollView>
  );
}
