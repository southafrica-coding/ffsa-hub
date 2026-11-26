// A screen pushed on the Me stack (redesign frames 6.3–6.22): the kit's
// PushedPage (compact bar with back + parent name, the screen's name centred
// in sentence case, keyboard-aware body) with "Me" as the default parent.
// These settings-style pages have no large caps title.

import { useRouter } from "expo-router";
import type { ReactNode } from "react";

import { PushedPage } from "@/components";

import { meStrings } from "../strings";

export function MePage({
  title,
  backLabel = meStrings.back,
  children,
  refreshing,
  onRefresh,
  tabBarHidden = false,
}: {
  /** The screen's name, shown in the bar and read as the page heading. */
  title: string;
  /** The parent screen's name beside the chevron (default "Me"). */
  backLabel?: string;
  children: ReactNode;
  /** Pull-to-refresh (both or neither). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Full-height forms hide the tab bar, so the page pads the home indicator itself. */
  tabBarHidden?: boolean;
}) {
  const router = useRouter();
  return (
    <PushedPage
      back={{ label: backLabel, onPress: () => router.back() }}
      title={title}
      refreshing={refreshing}
      onRefresh={onRefresh}
      tabBarHidden={tabBarHidden}
      gap={0}
    >
      {children}
    </PushedPage>
  );
}
