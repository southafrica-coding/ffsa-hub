import { GraduationCap } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { Button, Masthead, Screen } from "@/components";
import { Skeleton } from "@/features/finance/components/ui";
import { StateMessage, openWebPage } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { useSchoolsAccess } from "../shortcut";
import { strings } from "../strings";

const s = strings.gate;

// The /schools routes can be reached without the Home shortcut (a feed item,
// a notification, a link), so they ask the same question Home does. UX only:
// RLS still decides what the screens can read. When the answer couldn't be
// read at all (offline, nothing remembered) the screen is shown; it has its
// own offline and error states.
export function SchoolsGate({ children }: { children: ReactNode }) {
  const access = useSchoolsAccess();
  if (access === "checking") return <GateFrame><Skeleton label={s.checking} /></GateFrame>;
  if (access === "notAllowed") return <NotEligible />;
  return <>{children}</>;
}

function NotEligible() {
  const { colors } = useTheme();
  return (
    <GateFrame>
      <View testID="schools-not-eligible">
        <StateMessage icon={GraduationCap} title={s.title} body={s.body} />
        <Button
          label={s.openWeb}
          variant="secondary"
          accessibilityHint={s.openWebHint}
          onPress={() => void openWebPage("/my-schools", colors)}
        />
      </View>
    </GateFrame>
  );
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
