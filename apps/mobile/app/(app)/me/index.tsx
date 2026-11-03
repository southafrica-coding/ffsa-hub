import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Bell, ExternalLink, Pencil, ShieldCheck, Trash2, UserRound } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, Divider, Masthead, Screen, Text } from "@/components";
import { AppearanceIcon, appearanceStrings, useAppearance } from "@/features/appearance";
import { clearFeedCaches } from "@/features/home/feed-cache";
import { ACCOUNT_DELETION_URL, FULL_PROFILE_PATH, PRIVACY_POLICY_PATH } from "@/features/me/links";
import { meStrings as s } from "@/features/me/strings";
import { ListRow, SectionBar, SkeletonRows, openWebPage, roleLabels, useMe } from "@/features/shell";
import { displayName } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/theme/use-theme";

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return [first, last].filter(Boolean).join(" ").trim();
}

// Me: who you are, a few settings, links out to the web for the rest, and
// sign out (this phone only).
export default function MeScreen() {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const appearance = useAppearance();
  const { status, me, error, refresh } = useMe();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    // Saved Home items belong to this person: don't leave them on the phone.
    await clearFeedCaches();
    // This device only: signing out on the phone shouldn't end web sessions.
    await supabase.auth.signOut({ scope: "local" });
    setSigningOut(false);
  }

  const name = me ? fullName(me.profile?.firstName, me.profile?.lastName) || displayName(me) : s.fallbackTitle;
  const roles = roleLabels(me);
  const version = Constants.expoConfig?.version;

  return (
    <Screen edges={["top"]}>
      <Masthead context={s.context} title={name} />

      {status === "loading" ? <SkeletonRows count={2} label={s.loading} /> : null}

      {status === "error" ? (
        <Banner
          tone="danger"
          title={s.error.title}
          action={<Button label={s.error.retry} variant="secondary" onPress={refresh} />}
        >
          {error ?? ""}
        </Banner>
      ) : null}

      {me ? (
        <View style={{ gap: 12 }} testID="profile-card">
          <View accessible accessibilityLabel={s.a11y.field(s.email, me.user.email ?? "—")} style={{ gap: 2 }}>
            <Text variant="label" tone="secondary">
              {s.email}
            </Text>
            <Text selectable>{me.user.email ?? "—"}</Text>
          </View>
          <View accessible accessibilityLabel={s.a11y.field(s.roles, roles.length ? roles.join(", ") : s.noRoles)} style={{ gap: 2 }}>
            <Text variant="label" tone="secondary">
              {s.roles}
            </Text>
            <Text>{roles.length ? roles.join(" · ") : s.noRoles}</Text>
          </View>
        </View>
      ) : null}

      <View>
        <SectionBar label={s.sections.profile} />
        <ListRow
          icon={Pencil}
          title={s.rows.edit.title}
          subtitle={s.rows.edit.subtitle}
          onPress={() => router.push("/me/edit")}
          disabled={!me}
        />
        <ListRow
          icon={UserRound}
          title={s.rows.fullProfile.title}
          subtitle={s.rows.fullProfile.subtitle}
          trailing="web"
          onPress={() => void openWebPage(FULL_PROFILE_PATH, colors)}
        />
      </View>

      <View>
        <SectionBar label={s.sections.settings} />
        <ListRow
          icon={Bell}
          title={s.rows.notifications.title}
          subtitle={s.rows.notifications.subtitle}
          onPress={() => router.push("/me/notifications")}
        />
        <ListRow
          testID="appearance"
          icon={AppearanceIcon}
          title={s.appearance.label}
          subtitle={appearanceStrings.summary(appearance.preference, scheme)}
          onPress={() => router.push("/me/appearance")}
        />
      </View>

      <View>
        <SectionBar label={s.sections.about} />
        <ListRow
          icon={ShieldCheck}
          title={s.rows.privacy.title}
          trailing="web"
          onPress={() => void openWebPage(PRIVACY_POLICY_PATH, colors)}
        />
        <ListRow
          testID="request-deletion"
          icon={ACCOUNT_DELETION_URL ? ExternalLink : Trash2}
          title={s.rows.deletion.title}
          subtitle={ACCOUNT_DELETION_URL ? undefined : s.rows.deletion.subtitle}
          trailing={ACCOUNT_DELETION_URL ? "web" : "none"}
          disabled={!ACCOUNT_DELETION_URL}
          onPress={ACCOUNT_DELETION_URL ? () => void openWebPage(ACCOUNT_DELETION_URL!, colors) : undefined}
        />
        <View
          accessible
          accessibilityLabel={`${s.version.label}: ${version ?? s.version.unknown}`}
          style={{ paddingVertical: 12, paddingHorizontal: 4, gap: 2 }}
        >
          <Text variant="label" tone="secondary">
            {s.version.label}
          </Text>
          <Text>{version ? s.version.value(version) : s.version.unknown}</Text>
        </View>
      </View>

      <View style={{ flex: 1 }} />
      <Divider strong />
      <Button
        label={s.signOut}
        variant="secondary"
        onPress={signOut}
        loading={signingOut}
        accessibilityHint={s.signOutHint}
      />
    </Screen>
  );
}
