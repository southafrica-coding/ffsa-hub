import { useRouter } from "expo-router";
import { UsersRound } from "lucide-react-native";
import type { ReactNode } from "react";

import { Bleed, EmptyState, LargeTitleScrollView, SkeletonList } from "@/components";

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
        <SkeletonList label={s.checking} count={4} inset={false} />
      </GateFrame>
    );
  }
  if (access === "notAllowed") {
    return (
      <GateFrame>
        <EmptyState testID="ministries-not-allowed" icon={UsersRound} title={s.title} body={s.body} />
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
