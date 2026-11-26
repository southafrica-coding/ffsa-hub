import { useEffect } from "react";
import { AppState } from "react-native";

import { setTabBadge, useMe } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";

import { hasTrainingAccess } from "./logic";
import { getToday } from "./today";

const REFRESH_AFTER_MS = 5 * 60_000;

// Keeps the Training tab's badge (open Today items) current without opening
// the tab: once when /api/me says this person has Training, and again when
// the app comes back after five minutes. Renders nothing; failures are quiet
// (the badge just keeps its last number).
export function TrainingBadge() {
  const { me } = useMe();
  const allowed = hasTrainingAccess(me);

  useEffect(() => {
    if (!allowed) {
      setTabBadge("training", 0);
      return;
    }
    let last = 0;
    const load = () => {
      last = Date.now();
      getToday(apiFetch).then(
        (today) => setTabBadge("training", today.open),
        () => {},
      );
    };
    load();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && Date.now() - last > REFRESH_AFTER_MS) load();
    });
    return () => sub.remove();
  }, [allowed]);

  return null;
}
