import { UsersRound } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";

import { Masthead, Screen } from "@/components";
import { Skeleton } from "@/features/finance/components/ui";
import { StateMessage } from "@/features/shell";

import { useMinistriesAccess } from "../shortcut";
import { strings } from "../strings";

const s = strings.gate;

// The /ministries routes can be reached without the Home shortcut (a feed
// item, a notification, a link), so they ask the same question Home does.
// UX only: the endpoints check again. When the answer couldn't be read at
// all (offline, nothing remembered) the screen is shown; it has its own
// offline, error and no-access states.
export function MinistriesGate({ children }: { children: ReactNode }) {
  const access = useMinistriesAccess();
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
        <StateMessage testID="ministries-not-allowed" icon={UsersRound} title={s.title} body={s.body} />
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
