import { useKeepAwake } from "expo-keep-awake";
import { Stack } from "expo-router";
import { ScanLine } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Alert, View } from "react-native";

import { Banner, Button, Divider, Masthead, Text, TextField } from "@/components";
import { apiFetch } from "@/lib/api-client";
import { StoreProblemNotice, useNow } from "@/lib/outbox/OutboxStatus";
import { lastTriedText } from "@/lib/outbox/status";
import { useTheme } from "@/theme/use-theme";

import { staffDoorClient, type DoorClient } from "../api";
import { DoorStats } from "../components/DoorStats";
import { GuestSearch } from "../components/GuestSearch";
import { ScannerView } from "../components/ScannerView";
import { EmptyState } from "../components/StateViews";
import { TicketsScreen } from "../components/TicketsScreen";
import { VerdictCard } from "../components/VerdictCard";
import { useOnline } from "../hooks";
import { strings } from "../strings";
import { useDoor } from "../use-door";

type Props = {
  eventId: string;
  eventTitle?: string;
  /** Injected in tests and by the volunteer door; the staff door by default. */
  door?: DoorClient;
  /** Whose saved scans these are (see useDoor). The signed-in person by default. */
  queueOwner?: () => Promise<string | null>;
  /** Shown under the tally (the volunteer door's "Scanning as …" row). */
  intro?: ReactNode;
};

/**
 * One event's door: tally, scanner, typed code, name search. Keeps the
 * screen awake while it's open. Works offline by saving scans (clearly
 * marked "not yet confirmed") and sending them when the signal returns.
 */
export function DoorScreen({ eventId, eventTitle, door: injected, queueOwner, intro }: Props) {
  useKeepAwake();
  const { colors } = useTheme();
  const online = useOnline();
  const door = useMemo(() => injected ?? staffDoorClient(apiFetch, eventId), [injected, eventId]);
  const d = useDoor(eventId, door, online, undefined, queueOwner);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const now = useNow();

  if (d.denied) {
    return (
      <TicketsScreen>
        <EmptyState title={strings.checkIn.deniedTitle} body={strings.checkIn.deniedBody} />
      </TicketsScreen>
    );
  }

  if (scanning) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ScannerView
          paused={d.busy || !!d.verdict}
          onScanned={(data) => void d.onScanned(data)}
          onClose={() => {
            d.dismiss();
            setScanning(false);
          }}
          onTypeCode={() => setScanning(false)}
          overlay={
            d.verdict ? (
              <VerdictCard
                verdict={d.verdict}
                undoOpen={d.undoOpen}
                onUndo={() => void d.undo()}
                onDismiss={d.dismiss}
                dismissLabel={strings.result.scanNext}
              />
            ) : undefined
          }
        />
      </>
    );
  }

  async function submitCode() {
    await d.checkInCode(code);
    setCode("");
  }

  return (
    <TicketsScreen onRefresh={online ? () => void d.refreshStats() : undefined}>
      <Stack.Screen options={{ headerShown: true }} />
      <Masthead context={eventTitle ?? strings.checkIn.context} title={strings.checkIn.doorTitle} />
      <DoorStats stats={d.stats} failed={d.statsFailed} offline={!online} />
      {intro}

      {!online ? (
        <Banner tone="info" title={strings.common.offline} testID="offline-banner">
          {strings.checkIn.offline}
        </Banner>
      ) : null}

      {d.pending.length > 0 ? (
        <Banner
          tone="info"
          title={strings.checkIn.queueTitle(d.pending.length)}
          testID="queue-banner"
          action={online ? <Button label={strings.checkIn.queueSync} variant="secondary" loading={d.syncing} onPress={() => void d.sync()} /> : undefined}
        >
          {[strings.checkIn.queueBody, lastTriedText({ lastTriedAt: d.lastTriedAt }, now)].filter(Boolean).join(" ")}
        </Banner>
      ) : null}

      <StoreProblemNotice problem={d.problem} onDismiss={d.dismissProblem} />
      {d.failed.length > 0 ? (
        <Banner
          tone="danger"
          title={strings.outbox.failedTitle(d.failed.length)}
          testID="failed-banner"
          action={
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button label={strings.outbox.retry} variant="secondary" accessibilityHint={strings.outbox.retryHint} onPress={d.retryFailed} />
              <Button
                label={strings.outbox.remove}
                variant="ghost"
                accessibilityHint={strings.outbox.removeHint}
                onPress={() =>
                  Alert.alert(strings.outbox.removeTitle, strings.outbox.removeBody, [
                    { text: strings.outbox.cancel, style: "cancel" },
                    { text: strings.outbox.remove, style: "destructive", onPress: d.removeFailed },
                  ])
                }
              />
            </View>
          }
        >
          {`${strings.outbox.failedBody} ${d.failed.map((f) => `${f.code}${f.lastError ? ` (${f.lastError})` : ""}`).join(", ")}`}
        </Banner>
      ) : null}

      {d.rejected.length > 0 ? (
        <Banner
          tone="danger"
          title={strings.checkIn.queueRejected(d.rejected.length)}
          testID="rejected-banner"
          action={<Button label={strings.checkIn.queueClear} variant="secondary" onPress={d.clearRejected} />}
        >
          {`${strings.checkIn.queueRejectedBody} ${d.rejected.map((r) => r.code).join(", ")}`}
        </Banner>
      ) : null}

      {d.verdict ? <VerdictCard verdict={d.verdict} undoOpen={d.undoOpen} onUndo={() => void d.undo()} onDismiss={d.dismiss} /> : null}

      <Button
        label={strings.checkIn.scan}
        accessibilityHint={strings.checkIn.scanHint}
        icon={<ScanLine size={22} color={colors.onInverse} accessibilityElementsHidden importantForAccessibility="no" />}
        onPress={() => {
          d.dismiss();
          setScanning(true);
        }}
        style={{ minHeight: 64 }}
      />

      <Divider />
      <View style={{ gap: 8 }}>
        <Text variant="label" tone="secondary" accessibilityRole="header">
          {strings.checkIn.typeCode}
        </Text>
        <TextField
          label={strings.checkIn.codeField}
          hint={strings.checkIn.codeFieldHint}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => void submitCode()}
        />
        <Button label={strings.checkIn.checkInCode} variant="secondary" disabled={!code.trim() || d.busy} onPress={() => void submitCode()} />
      </View>

      <Divider />
      <View style={{ gap: 8 }}>
        <Text variant="label" tone="secondary" accessibilityRole="header">
          {strings.checkIn.search}
        </Text>
        <GuestSearch door={door} online={online} busy={d.busy} onCheckIn={d.checkInCode} />
      </View>
    </TicketsScreen>
  );
}
