import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { Banner, Button, Divider, Masthead, Screen, Text } from "@/components";
import { ApiError, displayName, getMe, type Me } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/theme/use-theme";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; me: Me };

function formatServerTime(iso: string | null) {
  if (!iso) return "Not reported";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// Placeholder Home: proves sign-in, the bearer-token API call to
// GET /api/me and sign-out work end to end. Real screens come in Phase 1.
export default function HomeScreen() {
  const { colors } = useTheme();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [signingOut, setSigningOut] = useState(false);

  // Bumped by "Try again" to re-run the fetch effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getMe(apiFetch, { signal: controller.signal }).then(
      (me) => setLoad({ state: "ready", me }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        // 401/403 have already signed the user out; the auth gate takes over.
        if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
        setLoad({
          state: "error",
          message: err instanceof ApiError ? err.message : "Something went wrong loading your account.",
        });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }

  async function signOut() {
    setSigningOut(true);
    // This device only: signing out on the phone shouldn't end web sessions.
    await supabase.auth.signOut({ scope: "local" });
    setSigningOut(false);
  }

  return (
    <Screen>
      <Masthead
        context="FFSA Hub · Home"
        title={load.state === "ready" ? `Hello, ${displayName(load.me)}` : "Home"}
      />

      {/* The one yellow band on this screen, showing the pattern. */}
      <Banner tone="needsYou" title="Placeholder" testID="needs-you">
        Home is a placeholder: real screens come in Phase 1.
      </Banner>

      {load.state === "loading" ? (
        <View className="items-center py-8" accessibilityLabel="Loading your account">
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}

      {load.state === "error" ? (
        <Banner
          tone="danger"
          title="Couldn't load your account"
          action={<Button label="Try again" variant="secondary" onPress={retry} />}
        >
          {load.message}
        </Banner>
      ) : null}

      {load.state === "ready" ? (
        <View className="gap-4">
          <View className="gap-1">
            <Text variant="label" tone="secondary">
              Permissions
            </Text>
            <Text variant="numeral" accessibilityLabel={`${load.me.permissions.length} permissions`}>
              {load.me.permissions.length}
            </Text>
          </View>
          <Divider />
          <View className="gap-2">
            <Text variant="label" tone="secondary">
              Roles
            </Text>
            {load.me.roles.length === 0 ? (
              <Text tone="secondary">No roles assigned.</Text>
            ) : (
              load.me.roles.map((r) => (
                <Text key={`${r.name}:${r.scopeType ?? ""}:${r.scopeId ?? ""}`}>
                  {r.name}
                  {r.scopeType ? <Text tone="secondary">{`  ·  ${r.scopeType}`}</Text> : null}
                </Text>
              ))
            )}
          </View>
          <Divider />
          <View className="gap-1">
            <Text variant="label" tone="secondary">
              Server time
            </Text>
            <Text>{formatServerTime(load.me.serverTime)}</Text>
          </View>
        </View>
      ) : null}

      <View className="flex-1" />
      <Divider strong />
      <Button label="Sign out" variant="secondary" onPress={signOut} loading={signingOut} />
    </Screen>
  );
}
