import { useRouter } from "expo-router";
import { ArrowUpRight, GraduationCap } from "lucide-react-native";
import type { ReactNode } from "react";

import { Bleed, Button, EmptyState, LargeTitleScrollView, ListGroup, SkeletonList } from "@/components";
import { openWebPage } from "@/features/shell";
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
  if (access === "checking") {
    return (
      <GateFrame>
        <Bleed>
          <SkeletonList label={s.checking} count={3} inset={false} />
        </Bleed>
      </GateFrame>
    );
  }
  if (access === "notAllowed") return <NotEligible />;
  return <>{children}</>;
}

/** Frame 8.5: its own screen, with the way to the website. */
function NotEligible() {
  const { colors } = useTheme();
  return (
    <GateFrame>
      <Bleed>
        <ListGroup inset={false} testID="schools-not-eligible">
          <EmptyState card={false} icon={GraduationCap} title={s.title} body={s.body} />
        </ListGroup>
      </Bleed>
      <Button
        label={s.openWeb}
        variant="secondary"
        icon={<ArrowUpRight size={20} color={colors.text} />}
        accessibilityHint={s.openWebHint}
        onPress={() => void openWebPage("/my-schools", colors)}
      />
    </GateFrame>
  );
}

function GateFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <LargeTitleScrollView
      eyebrow={strings.list.context}
      title={strings.list.title}
      back={{ label: strings.common.home, onPress: () => router.navigate("/") }}
    >
      {children}
    </LargeTitleScrollView>
  );
}
