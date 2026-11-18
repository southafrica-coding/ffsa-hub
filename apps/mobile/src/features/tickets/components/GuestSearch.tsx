import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";

import { announce } from "@/lib/a11y";
import { ActivityIndicator, View } from "react-native";

import { Button, Text, TextField } from "@/components";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { DoorClient, Guest } from "../api";
import { formatClock } from "../dates";
import { isSignedOutError } from "../hooks";
import { strings } from "../strings";

export const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  door: Pick<DoorClient, "search">;
  online: boolean;
  busy: boolean;
  onCheckIn: (code: string) => Promise<void>;
};

type Results =
  | { state: "idle" }
  | { state: "loading"; query: string }
  | { state: "error"; query: string }
  | { state: "done"; query: string; guests: Guest[] };

/** Find a guest by name when their QR won't scan; one tap checks them in. */
export function GuestSearch({ door, online, busy, onCheckIn }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [fetched, setResults] = useState<Results>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const q = query.trim();
  const active = q.length >= 2 && online;
  // Only show results for what's typed now (older answers are ignored).
  const results: Results = active && fetched.state !== "idle" && fetched.query === q ? fetched : { state: "idle" };

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      setResults({ state: "loading", query: q });
      door.search(q, { signal: controller.signal }).then(
        (guests) => setResults({ state: "done", query: q, guests }),
        (err: unknown) => {
          if (controller.signal.aborted || isSignedOutError(err)) return;
          setResults({ state: "error", query: q });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, active, door, attempt]);

  // Tell screen-reader users the search finished (the list appears silently).
  const doneCount = results.state === "done" ? results.guests.length : null;
  useEffect(() => {
    if (doneCount !== null) announce(doneCount === 0 ? strings.checkIn.searchEmpty : strings.a11y.searchResults(doneCount));
  }, [doneCount, q]);

  async function checkIn(g: Guest) {
    await onCheckIn(g.code);
    setAttempt((n) => n + 1); // refresh the list so the row shows "In at …"
  }

  return (
    <View style={{ gap: 8 }}>
      <TextField
        label={strings.checkIn.searchField}
        hint={online ? strings.checkIn.searchHint : strings.checkIn.searchOffline}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        editable={online}
      />
      {results.state === "loading" ? <ActivityIndicator color={colors.text} accessibilityLabel={strings.a11y.searching} /> : null}
      {results.state === "error" ? (
        <Text tone="danger" accessibilityRole="alert">
          {strings.checkIn.searchError}
        </Text>
      ) : null}
      {results.state === "done" && results.guests.length === 0 ? <Text tone="secondary">{strings.checkIn.searchEmpty}</Text> : null}
      {results.state === "done"
        ? results.guests.map((g) => {
            const inAt = g.status === "checked_in" ? formatClock(g.checkedInAt) : null;
            return (
              <View
                key={g.ticketId}
                testID={`guest-${g.ticketId}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: hairline,
                  borderBottomColor: colors.rule,
                }}
              >
                <View style={{ flex: 1 }} accessible accessibilityLabel={[
                    g.name,
                    g.ticketTypeName,
                    inAt ? strings.checkIn.guestIn(inAt) : g.status === "checked_in" ? strings.status.checked_in : null,
                  ]
                    .filter(Boolean)
                    .join(". ")}
                >
                  <Text variant="bodyStrong">{g.name}</Text>
                  <Text variant="caption" tone="secondary">
                    {g.ticketTypeName}
                  </Text>
                </View>
                {g.status === "checked_in" ? (
                  // Already in the row's label above, so not read twice.
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Check size={16} color={colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
                    <Text variant="monoLabel" tone="secondary">
                      {inAt ? strings.checkIn.guestIn(inAt) : strings.status.checked_in}
                    </Text>
                  </View>
                ) : (
                  <Button
                    label={strings.checkIn.guestCheckIn}
                    accessibilityLabel={strings.checkIn.guestCheckInA11y(g.name)}
                    disabled={busy}
                    onPress={() => void checkIn(g)}
                  />
                )}
              </View>
            );
          })
        : null}
    </View>
  );
}
