import { render } from "@testing-library/react-native";
import { Clock, Wallet } from "lucide-react-native";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  Banner,
  Button,
  Divider,
  EmptyState,
  LargeTitle,
  LargeTitleScrollView,
  ListGroup,
  ListRow,
  MoneyText,
  NeedsYouBand,
  PhotoSlot,
  SectionHeader,
  SegmentedControl,
  Sheet,
  Skeleton,
  SkeletonList,
  StatusChip,
  Text,
  TextField,
  Toggle,
  WebHint,
} from "..";

// The kit gallery, as snapshots: every component in light and dark, so the
// feature slices (R2/R3) can read exactly what each one renders and spot an
// unintended change. Mirrors the mockups' component sheet. Not an in-app
// screen on purpose.

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
// Static skeletons, so snapshots don't depend on animation timing.
jest.mock("@/lib/a11y", () => ({ ...jest.requireActual("@/lib/a11y"), useReduceMotion: () => true }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => {}) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const noop = () => {};

function Gallery() {
  return (
    <View>
      <LargeTitle eyebrow="Eyebrow" title="Large title" subtitle="One line of body text under the title." />
      <LargeTitle eyebrow="Spaces and vehicles" title="Bookings" back={{ label: "Home", onPress: noop }} />
      <LargeTitle eyebrow="FFSA Hub" title="Sign in" hero />
      <NeedsYouBand eyebrow="Needs you · 3" text="Booking request: Seminar room" actionLabel="Open" onAction={noop} />
      <Button label="Primary" />
      <Button label="Secondary" variant="secondary" />
      <Button label="Text button" variant="text" />
      <Button label="Destructive" variant="danger" />
      <Button label="Delete account" variant="dangerFill" />
      <Button label="Small" size="small" />
      <Button label="Disabled" disabled />
      <Button label="Saving" loading />
      <StatusChip label="Paid" variant="positive" />
      <StatusChip label="Due soon" variant="attention" />
      <StatusChip label="Cancelled" variant="danger" />
      <StatusChip label="You" variant="ink" />
      <StatusChip label="Needs a lead" variant="dashed" />
      <StatusChip label="Staff" variant="quiet" />
      <StatusChip label="In progress" icon={Clock} />
      <SegmentedControl
        items={[
          { key: "week", label: "Week" },
          { key: "practice", label: "Practice" },
          { key: "mine", label: "My sets" },
        ]}
        value="week"
        onChange={noop}
      />
      <SectionHeader title="Needs you" actionLabel="Mark all read" onAction={noop} />
      <ListGroup>
        <ListRow icon={Wallet} title="List row" subtitle="Caption under the title" onPress={noop} />
        <ListRow unread title="Unread row" subtitle="Dot + bold title" onPress={noop} />
        <ListRow unread={false} title="Read row" subtitle="Regular weight" onPress={noop} />
        <ListRow title="Money cell" subtitle="Tabular figures" meta={<MoneyText amount={12450} options={{ cents: false }} variant="rowTitle" />} />
        <ListRow title="Opens in the website" trailing="web" onPress={noop} />
        <ListRow title="Saved offline" disabled onPress={noop}>
          <Text variant="caption" tone="secondary">
            Saved on this phone, not yet sent
          </Text>
        </ListRow>
      </ListGroup>
      <TextField label="Field" value="Gabriël" onChangeText={noop} />
      <TextField label="Field — error" value="x" onChangeText={noop} error="Plain-English reason." />
      <TextField label="Field — hint" value="" placeholder="you@example.com" onChangeText={noop} hint="We never share it." />
      <TextField label="Password" value="secret" onChangeText={noop} secure />
      <TextField label="Read only" value="gabriel@example.com" editable={false} />
      <Banner tone="offline">Offline. Showing what was saved at 08:42.</Banner>
      <Banner tone="error" actionLabel="Try again" onAction={noop}>
        {"Couldn't refresh."}
      </Banner>
      <Banner tone="queued">Saved on this phone, not yet sent</Banner>
      <Banner tone="info" title="Heads up">
        Bookings open on Sunday.
      </Banner>
      <Toggle value accessibilityLabel="On" />
      <Toggle value={false} accessibilityLabel="Off" />
      <PhotoSlot hasPhoto={false} onTake={noop} onChoose={noop} />
      <PhotoSlot hasPhoto onView={noop} onTake={noop} onChoose={noop} onRemove={noop} />
      <EmptyState icon={Clock} title="You're all caught up" />
      <EmptyState title="Couldn't load your bookings." body="Check your signal, then try again." actionLabel="Try again" onAction={noop} />
      <Skeleton width="62%" />
      <SkeletonList count={2} label="Loading" />
      <MoneyText amount={3240} variant="kpi" />
      <WebHint />
      <Divider />
      <Divider strong />
      {(["eyebrow", "label", "monoLabel", "caption", "body", "sectionTitle", "rowTitle", "pageTitle", "hero", "kpi", "note"] as const).map((v) => (
        <Text key={v} variant={v}>
          {v}
        </Text>
      ))}
      <Sheet visible title="Sheet title" subtitle="One line" onClose={noop} footer={<Button label="Save" />}>
        <Text>Sheet body</Text>
      </Sheet>
    </View>
  );
}

describe.each(["light", "dark"] as const)("kit gallery (%s)", (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it("renders every component", async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Gallery />
      </SafeAreaProvider>,
    );
    expect(r.toJSON()).toMatchSnapshot();
  });

  it("renders the collapsing large-title page", async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <LargeTitleScrollView eyebrow="Tickets" title="My tickets" back={{ label: "Home", onPress: noop }}>
          <ListGroup>
            <ListRow title="Send Night" subtitle="Sat 12 Dec · 18:30" onPress={noop} />
          </ListGroup>
        </LargeTitleScrollView>
      </SafeAreaProvider>,
    );
    expect(r.toJSON()).toMatchSnapshot();
  });
});
