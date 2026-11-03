import { useRouter, type Href } from "expo-router";
import { CalendarDays, Check, CircleUser, GraduationCap, Ticket, Wallet } from "lucide-react-native";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen, Text } from "@/components";
import type { FeedItem } from "@/features/home/api";
import { groupFeed, resolveTarget, timeAgo } from "@/features/home/feed-logic";
import { NotificationRow } from "@/features/home/NotificationRow";
import { homeStrings as s } from "@/features/home/strings";
import { useFeed } from "@/features/home/use-feed";
import { useSchoolsShortcut } from "@/features/schools/shortcut";
import { strings as schoolsStrings } from "@/features/schools/strings";
import { BarAction, ListRow, SectionBar, SkeletonRows, StateMessage, openWebPage, useMe } from "@/features/shell";
import { displayName } from "@/lib/api";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

// Home: the "needs you" feed (GET /api/notifications, the same items as the
// web dashboard), one yellow band when something is unread, then shortcuts.
export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const { me } = useMe();
  const feed = useFeed(session?.user?.id ?? null);
  const showSchools = useSchoolsShortcut();
  const { needsYou, earlier } = groupFeed(feed.items);
  const now = feed.asOf;

  function open(item: FeedItem) {
    feed.markRead([item.key]);
    const target = resolveTarget(item.href);
    if (target.kind === "app") router.navigate(target.path as Href);
    else if (target.kind === "web") void openWebPage(target.path, colors);
  }

  const top = needsYou[0];

  return (
    <Screen scroll={false} edges={["top"]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={feed.refresh}
            {...refreshControlColors(colors)}
          />
        }
      >
        <Masthead context={s.context} title={s.greeting(me ? displayName(me) : null)} />

        {feed.notice?.kind === "offline" ? (
          <Banner tone="info" title={s.offline.title} testID="offline-banner">
            {s.offline.body(timeAgo(feed.savedAt, now))}
          </Banner>
        ) : null}
        {feed.notice?.kind === "stale" ? (
          <Banner tone="info" title={s.stale.title} testID="stale-banner">
            {s.stale.body(feed.notice.message)}
          </Banner>
        ) : null}

        {/* The ONE yellow band on this screen, only when something is unread. */}
        {top ? (
          <Banner
            tone="needsYou"
            title={s.band.title}
            testID="needs-you"
            action={
              <Button
                label={s.band.open}
                accessibilityLabel={s.band.openA11y(top.title)}
                onPress={() => open(top)}
              />
            }
          >
            <View style={{ gap: 2 }}>
              <Text variant="title" tone="onAccent">
                {s.band.count(needsYou.length)}
              </Text>
              <Text tone="onAccent">{top.title}</Text>
            </View>
          </Banner>
        ) : null}

        {feed.status === "loading" ? <SkeletonRows label={s.loading} /> : null}

        {feed.status === "error" ? (
          <Banner
            tone="danger"
            title={s.error.title}
            action={<Button label={s.error.retry} variant="secondary" onPress={feed.retry} />}
          >
            {feed.error ?? ""}
          </Banner>
        ) : null}

        {feed.status === "forbidden" ? (
          <StateMessage testID="feed-forbidden" title={s.forbidden.title} body={s.forbidden.body} />
        ) : null}

        {feed.status === "ready" && feed.items.length === 0 ? (
          <StateMessage testID="feed-empty" icon={Check} title={s.empty.title} body={s.empty.body} />
        ) : null}

        {needsYou.length > 0 ? (
          <View>
            <SectionBar
              label={s.sections.needsYou(needsYou.length)}
              right={
                <BarAction
                  testID="mark-all-read"
                  label={s.markAllRead}
                  accessibilityLabel={s.markAllReadA11y(needsYou.length)}
                  onPress={() => feed.markRead(needsYou.map((i) => i.key))}
                />
              }
            />
            {needsYou.map((item) => (
              <NotificationRow
                key={item.key}
                item={item}
                when={timeAgo(item.createdAt, now)}
                target={resolveTarget(item.href)}
                onPress={() => open(item)}
              />
            ))}
          </View>
        ) : null}

        {earlier.length > 0 ? (
          <View>
            <SectionBar label={s.sections.earlier} />
            {earlier.map((item) => (
              <NotificationRow
                key={item.key}
                item={item}
                when={timeAgo(item.createdAt, now)}
                target={resolveTarget(item.href)}
                onPress={() => open(item)}
              />
            ))}
          </View>
        ) : null}

        <View>
          <SectionBar label={s.sections.shortcuts} />
          <ListRow
            icon={Wallet}
            title={s.shortcuts.finance.title}
            subtitle={s.shortcuts.finance.subtitle}
            onPress={() => router.navigate("/finance")}
          />
          <ListRow
            icon={Ticket}
            title={s.shortcuts.tickets.title}
            subtitle={s.shortcuts.tickets.subtitle}
            onPress={() => router.navigate("/tickets")}
          />
          <ListRow
            icon={CalendarDays}
            title={s.shortcuts.bookings.title}
            subtitle={s.shortcuts.bookings.subtitle}
            onPress={() => router.navigate("/bookings")}
          />
          {showSchools ? (
            <ListRow
              icon={GraduationCap}
              title={schoolsStrings.shortcut.title}
              subtitle={schoolsStrings.shortcut.subtitle}
              onPress={() => router.navigate("/schools")}
            />
          ) : null}
          <ListRow
            icon={CircleUser}
            title={s.shortcuts.me.title}
            subtitle={s.shortcuts.me.subtitle}
            onPress={() => router.navigate("/me")}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
