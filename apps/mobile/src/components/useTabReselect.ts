import { use, useEffect, useRef, type RefObject } from "react";
import { NavigationContext } from "expo-router/react-navigation";

import { useReduceMotion } from "@/lib/a11y";

// Re-tapping the tab you're on (normal iPhone behaviour, spec §9): the first
// tap scrolls the screen to the top; once it's at the top, the next tap pops
// the tab's stack to its root. The pop is React Navigation's own: a stack
// inside a tab pops to the top on tabPress unless a listener prevents it, so
// all this hook does is scroll (and prevent the pop) while there's somewhere
// to scroll back to.

type TabPressEvent = { preventDefault: () => void };
type Nav = {
  isFocused: () => boolean;
  getParent?: () => Nav | undefined;
  addListener?: (type: "tabPress", listener: (e: TabPressEvent) => void) => () => void;
};

/**
 * Call `onReselect` when the person taps the tab this (focused) screen is in.
 * Return true when it did something (scrolled to the top): the tab press is
 * then consumed, so the stack doesn't also pop. No-op outside a navigator
 * (component tests, the volunteer door).
 */
export function useTabReselect(onReselect: () => boolean) {
  const navigation = use(NavigationContext) as Nav | undefined;
  const handler = useRef(onReselect);
  useEffect(() => {
    handler.current = onReselect;
  });
  useEffect(() => {
    if (!navigation) return;
    // Only a tab navigator emits tabPress, at the route of the tab: that's
    // this screen's own navigation for a tab root, or the parent's for a
    // screen in a tab's stack. Listen at each level; handle each press once.
    const seen = new WeakSet<TabPressEvent>();
    const unsubscribe: (() => void)[] = [];
    for (let level: Nav | undefined = navigation; level; level = level.getParent?.()) {
      const off = level.addListener?.("tabPress", (e) => {
        if (seen.has(e)) return;
        seen.add(e);
        if (!navigation.isFocused()) return;
        if (handler.current()) e.preventDefault();
      });
      if (off) unsubscribe.push(off);
    }
    return () => unsubscribe.forEach((off) => off());
  }, [navigation]);
}

type Scrollable = {
  scrollTo?: (o: { x?: number; y: number; animated?: boolean }) => void;
  scrollToOffset?: (o: { offset: number; animated?: boolean }) => void;
};

/**
 * useTabReselect for a scroll view or list: scrolls `ref` back to the top
 * when `offset()` says it has moved (more than a couple of points). Under
 * Reduce Motion the jump isn't animated.
 */
export function useScrollToTopOnTabPress(ref: RefObject<unknown>, offset: () => number) {
  const reduceMotion = useReduceMotion();
  useTabReselect(() => {
    const node = ref.current as Scrollable | null;
    if (!node || offset() <= 2) return false;
    if (node.scrollToOffset) node.scrollToOffset({ offset: 0, animated: !reduceMotion });
    else if (node.scrollTo) node.scrollTo({ y: 0, animated: !reduceMotion });
    else return false;
    return true;
  });
}
