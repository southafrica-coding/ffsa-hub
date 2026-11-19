import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  Bell,
  BriefcaseBusiness,
  CarFront,
  HeartPulse,
  IdCard,
  LogOut,
  Pencil,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, FadeIn, LargeTitleScrollView, ListRow, StaticRow, StatusChip, Text } from "@/components";
import { AppearanceIcon, appearanceStrings, useAppearance } from "@/features/appearance";
import { clearFeedCaches } from "@/features/home/feed-cache";
import { Group, GroupSkeleton, Section } from "@/features/me/components/me-kit";
import { isStaff } from "@/features/me/docs-logic";
import { ACCOUNT_DELETION_ROUTE, DOC_ROUTES, FULL_PROFILE_PATH, PRIVACY_POLICY_PATH } from "@/features/me/links";
import { meStrings as s } from "@/features/me/strings";
import { unregisterPushOnSignOut } from "@/features/push";
import { openWebPage, roleLabels, useMe } from "@/features/shell";
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
    // Stop pushes to this phone while the session can still say so (bounded).
    await unregisterPushOnSignOut();
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
    <LargeTitleScrollView eyebrow={s.context} title={name} gap={0}>
      {status === "loading" ? <GroupSkeleton count={2} label={s.loading} /> : null}

      {status === "error" ? (
        <Banner tone="error" title={s.error.title} actionLabel={s.error.retry} onAction={refresh}>
          {error ?? ""}
        </Banner>
      ) : null}

      {me ? (
        <FadeIn>
          <View style={{ gap: 12 }} testID="profile-card">
            <View accessible accessibilityLabel={s.a11y.field(s.email, me.user.email ?? "—")} style={{ gap: 2 }}>
              <Text variant="label">{s.email}</Text>
              <Text selectable>{me.user.email ?? "—"}</Text>
            </View>
            <View accessible accessibilityLabel={s.a11y.field(s.roles, roles.length ? roles.join(", ") : s.noRoles)} style={{ gap: 4 }}>
              <Text variant="label">{s.roles}</Text>
              {roles.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {roles.map((role) => (
                    <StatusChip key={role} label={role} variant="quiet" icon={null} />
                  ))}
                </View>
              ) : (
                <Text>{s.noRoles}</Text>
              )}
            </View>
          </View>
        </FadeIn>
      ) : null}

      <Section title={s.sections.profile} />
      <Group>
        <ListRow
          icon={Pencil}
          title={s.rows.edit.title}
          subtitle={s.rows.edit.subtitle}
          onPress={() => router.push("/me/edit")}
          disabled={!me}
        />
      </Group>

      <Section title={s.sections.documents} />
      <Group>
        <ListRow icon={UsersRound} title={s.rows.household.title} subtitle={s.rows.household.subtitle} onPress={() => router.push(DOC_ROUTES.household)} />
        <ListRow icon={CarFront} title={s.rows.licence.title} subtitle={s.rows.licence.subtitle} onPress={() => router.push(DOC_ROUTES.licence)} />
        <ListRow icon={IdCard} title={s.rows.passport.title} subtitle={s.rows.passport.subtitle} onPress={() => router.push(DOC_ROUTES.passport)} />
        <ListRow icon={HeartPulse} title={s.rows.insurance.title} subtitle={s.rows.insurance.subtitle} onPress={() => router.push(DOC_ROUTES.insurance)} />
        {/* The web shows the staff CV (Work tab) to staff only; the API still decides. */}
        {isStaff(me) ? (
          <ListRow icon={BriefcaseBusiness} title={s.rows.cv.title} subtitle={s.rows.cv.subtitle} onPress={() => router.push(DOC_ROUTES.cv)} />
        ) : null}
        <ListRow
          icon={UserRound}
          title={s.rows.fullProfile.title}
          subtitle={s.rows.fullProfile.subtitle}
          trailing="web"
          onPress={() => void openWebPage(FULL_PROFILE_PATH, colors)}
        />
      </Group>

      <Section title={s.sections.settings} />
      <Group>
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
      </Group>

      <Section title={s.sections.about} />
      <Group>
        <ListRow
          icon={ShieldCheck}
          title={s.rows.privacy.title}
          trailing="web"
          onPress={() => void openWebPage(PRIVACY_POLICY_PATH, colors)}
        />
        <ListRow
          testID="request-deletion"
          icon={Trash2}
          title={s.rows.deletion.title}
          subtitle={s.rows.deletion.subtitle}
          onPress={() => router.push(ACCOUNT_DELETION_ROUTE)}
        />
        <StaticRow
          title={s.version.label}
          subtitle={version ? s.version.value(version) : s.version.unknown}
          accessibilityLabel={`${s.version.label}: ${version ?? s.version.unknown}`}
        />
      </Group>

      {/* One tap, no confirm: it only signs this phone out. */}
      <View style={{ marginTop: 24, gap: 8 }}>
        <Button
          label={s.signOut}
          variant="secondary"
          icon={<LogOut size={20} color={colors.text} />}
          onPress={signOut}
          loading={signingOut}
          accessibilityHint={s.signOutHint}
        />
        {/* The button's hint says the same to screen readers. */}
        <Text
          variant="caption"
          tone="secondary"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ textAlign: "center" }}
        >
          {s.signOutHint}
        </Text>
      </View>
    </LargeTitleScrollView>
  );
}
