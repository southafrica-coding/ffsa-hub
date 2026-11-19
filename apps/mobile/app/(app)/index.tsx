import { useRouter, type Href } from "expo-router";
import {
  CalendarDays,
  Check,
  CircleUser,
  GraduationCap,
  History,
  RefreshCw,
  Target,
  Ticket,
  UserCheck,
  UsersRound,
  Wallet,
} from "lucide-react-native";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, EmptyState, LargeTitleScrollView, ListGroup, ListRow, SectionHeader } from "@/components";
import { strings as historyStrings } from "@/features/history/strings";
import type { FeedItem } from "@/features/home/api";
import { groupFeed, resolveTarget, timeAgo } from "@/features/home/feed-logic";
import { NotificationRow } from "@/features/home/NotificationRow";
import { homeStrings as s } from "@/features/home/strings";
import { FeedSectionHeader, HomeNeedsYouBand, HomeSkeleton, refreshHaptic } from "@/features/home/ui";
import { useFeed } from "@/features/home/use-feed";
import { useMinistriesShortcut } from "@/features/ministries/shortcut";
import { strings as ministriesStrings } from "@/features/ministries/strings";
import { strings as okrsStrings } from "@/features/okrs/strings";
import { useSchoolsShortcut } from "@/features/schools/shortcut";
import { strings as schoolsStrings } from "@/features/schools/strings";
import { openWebPage, useMe } from "@/features/shell";
import { useStaffDecisionsAccess } from "@/features/staff-decisions/access";
import { strings as staffDecisionsStrings } from "@/features/staff-decisions/strings";
import { displayName } from "@/lib/api";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The page gutter is 20; the band, banners and cards sit 16 from the edge.
const BLEED = space.inset - space.gutter;
const block = { marginHorizontal: BLEED } as const;

// Home: the "needs you" feed (GET /api/notifications, the same items as the
// web dashboard), one yellow band when something is unread, then shortcuts.
export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const { me } = useMe();
  const feed = useFeed(session?.user?.id ?? null);
  const showSchools = useSchoolsShortcut();
  const showMinistries = useMinistriesShortcut();
  const showStaffDecisions = useStaffDecisionsAccess() === "allowed";
  const { needsYou, earlier } = groupFeed(feed.items);
  const now = feed.asOf;

  function open(item: FeedItem) {
    feed.markRead([item.key]);
    const target = resolveTarget(item.href);
    if (target.kind === "app") router.navigate(target.path as Href);
    else if (target.kind === "web") void openWebPage(target.path, colors);
  }

  function onRefresh() {
    refreshHaptic();
    void feed.refresh();
  }

  const top = needsYou[0];
  const rows = (items: FeedItem[]) =>
    items.map((item) => (
      <NotificationRow
        key={item.key}
        item={item}
        when={timeAgo(item.createdAt, now)}
        target={resolveTarget(item.href)}
        onPress={() => open(item)}
      />
    ));

  return (
    <LargeTitleScrollView
      eyebrow={s.context}
      title={s.greeting(me ? displayName(me) : null)}
      gap={0}
      refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />}
    >
      {feed.notice?.kind === "offline" ? (
        <View style={[block, { marginBottom: space.md }]}>
          <Banner tone="offline" title={s.offline.title} testID="offline-banner">
            {s.offline.body(timeAgo(feed.savedAt, now))}
          </Banner>
        </View>
      ) : null}
      {feed.notice?.kind === "stale" ? (
        <View style={[block, { marginBottom: space.md }]}>
          <Banner tone="info" icon={RefreshCw} title={s.stale.title} testID="stale-banner">
            {s.stale.body(feed.notice.message)}
          </Banner>
        </View>
      ) : null}

      {/* The ONE yellow band on this screen, only when something is unread. */}
      {top ? (
        <View style={block}>
          <HomeNeedsYouBand
            testID="needs-you"
            eyebrow={s.band.title}
            text={s.band.count(needsYou.length)}
            detail={top.title}
            actionLabel={s.band.open}
            actionAccessibilityLabel={s.band.openA11y(top.title)}
            onAction={() => open(top)}
          />
        </View>
      ) : null}

      {feed.status === "loading" ? <HomeSkeleton label={s.loading} bleed={BLEED} /> : null}

      {feed.status === "error" ? (
        <View style={block}>
          <Banner
            tone="error"
            title={s.error.title}
            action={<Button label={s.error.retry} variant="secondary" size="small" onPress={feed.retry} />}
          >
            {feed.error ?? ""}
          </Banner>
        </View>
      ) : null}

      {feed.status === "forbidden" ? (
        <View style={block}>
          <EmptyState testID="feed-forbidden" title={s.forbidden.title} body={s.forbidden.body} />
        </View>
      ) : null}

      {/* Only when the feed has no items at all: read items just sit under Earlier. */}
      {feed.status === "ready" && feed.items.length === 0 ? (
        <View style={block}>
          <EmptyState testID="feed-empty" icon={Check} title={s.empty.title} body={s.empty.body} />
        </View>
      ) : null}

      {needsYou.length > 0 ? (
        <View>
          <FeedSectionHeader
            title={s.sections.needsYou(needsYou.length)}
            actionLabel={s.markAllRead}
            actionAccessibilityLabel={s.markAllReadA11y(needsYou.length)}
            actionTestID="mark-all-read"
            onAction={() => feed.markRead(needsYou.map((i) => i.key))}
          />
          {rows(needsYou)}
        </View>
      ) : null}

      {earlier.length > 0 ? (
        <View>
          <SectionHeader inset={false} title={s.sections.earlier} />
          {rows(earlier)}
        </View>
      ) : null}

      {/* Fixed order; rows the person can't open simply drop out. */}
      <SectionHeader inset={false} title={s.sections.shortcuts} />
      <ListGroup inset={false} style={block}>
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
          icon={History}
          title={historyStrings.shortcut.title}
          subtitle={historyStrings.shortcut.subtitle}
          onPress={() => router.navigate("/history")}
        />
        <ListRow
          icon={Target}
          title={okrsStrings.shortcut.title}
          subtitle={okrsStrings.shortcut.subtitle}
          onPress={() => router.navigate("/okrs")}
        />
        {showMinistries ? (
          <ListRow
            testID="shortcut-ministries"
            icon={UsersRound}
            title={ministriesStrings.shortcut.title}
            subtitle={ministriesStrings.shortcut.subtitle}
            onPress={() => router.navigate("/ministries")}
          />
        ) : null}
        {showStaffDecisions ? (
          <ListRow
            testID="shortcut-staff-decisions"
            icon={UserCheck}
            title={staffDecisionsStrings.shortcut.title}
            subtitle={staffDecisionsStrings.shortcut.subtitle}
            onPress={() => router.navigate("/staff-decisions")}
          />
        ) : null}
        <ListRow
          icon={CircleUser}
          title={s.shortcuts.me.title}
          subtitle={s.shortcuts.me.subtitle}
          onPress={() => router.navigate("/me")}
        />
      </ListGroup>
    </LargeTitleScrollView>
  );
}
