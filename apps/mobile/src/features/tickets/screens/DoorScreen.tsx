import { useKeepAwake } from "expo-keep-awake";
import { Lock, ScanLine, X } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Alert, View } from "react-native";

import { Banner, Button, Divider, EmptyState, Text, TextField, type BackAction } from "@/components";
import { apiFetch } from "@/lib/api-client";
import { StoreProblemNotice, useNow } from "@/lib/outbox/OutboxStatus";
import { lastTriedText } from "@/lib/outbox/status";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { staffDoorClient, type DoorClient } from "../api";
import { DoorStats } from "../components/DoorStats";
import { GuestSearch } from "../components/GuestSearch";
import { ScannerView } from "../components/ScannerView";
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
  /** Page title: "Door" for staff, "Door scanner" on the volunteer link. */
  title?: string;
  /** Back chevron + parent name (the staff door, from the Check-in list). */
  back?: BackAction;
  /** Trailing header action (the volunteer door's Done). */
  navRight?: ReactNode;
  /** Leading bar content instead of a back button (the volunteer door's Done). */
  navLeft?: ReactNode;
};

/**
 * One event's door: tally, scanner, typed code, name search. Full screen
 * (no tab bar); the camera opens over it with only Close and the torch.
 * Keeps the screen awake while it's open. Works offline by saving scans (clearly
 * marked "not yet confirmed") and sending them when the signal returns.
 */
export function DoorScreen({ eventId, eventTitle, door: injected, queueOwner, intro, title = strings.checkIn.doorTitle, back, navRight, navLeft }: Props) {
  useKeepAwake();
  const { colors } = useTheme();
  const online = useOnline();
  const door = useMemo(() => injected ?? staffDoorClient(apiFetch, eventId), [injected, eventId]);
  const d = useDoor(eventId, door, online, undefined, queueOwner);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const now = useNow();

  const header = { eyebrow: eventTitle ?? strings.checkIn.context, title, back, navRight, navLeft, bottomInset: true };

  if (d.denied) {
    return (
      <TicketsScreen {...header}>
        <EmptyState icon={Lock} title={strings.checkIn.deniedTitle} body={strings.checkIn.deniedBody} testID="empty-state" />
      </TicketsScreen>
    );
  }

  if (scanning) {
    return (
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
    );
  }

  async function submitCode() {
    await d.checkInCode(code);
    setCode("");
  }

  return (
    <TicketsScreen {...header} keyboard onRefresh={online ? () => void d.refreshStats() : undefined}>
      <DoorStats stats={d.stats} failed={d.statsFailed} offline={!online} />
      {intro}

      {!online ? (
        <Banner tone="offline" title={strings.common.offline} testID="offline-banner">
          {strings.checkIn.offline}
        </Banner>
      ) : null}

      {d.pending.length > 0 ? (
        <Banner
          tone="queued"
          title={strings.checkIn.queueTitle(d.pending.length)}
          testID="queue-banner"
          actionLabel={online ? strings.checkIn.queueSync : undefined}
          onAction={online ? () => void d.sync() : undefined}
          actionBusy={d.syncing}
        >
          {[strings.checkIn.queueBody, lastTriedText({ lastTriedAt: d.lastTriedAt }, now)].filter(Boolean).join(" ")}
        </Banner>
      ) : null}

      <StoreProblemNotice problem={d.problem} onDismiss={d.dismissProblem} />

      {d.rejected.length > 0 ? (
        <Banner
          tone="error"
          icon={X}
          title={strings.checkIn.queueRejected(d.rejected.length)}
          testID="rejected-banner"
          actionLabel={strings.checkIn.queueClear}
          onAction={d.clearRejected}
        >
          {`${strings.checkIn.queueRejectedBody} ${d.rejected.map((r) => r.code).join(", ")}`}
        </Banner>
      ) : null}

      {d.failed.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Banner tone="error" title={strings.outbox.failedTitle(d.failed.length)} testID="failed-banner">
            {`${strings.outbox.failedBody} ${d.failed.map((f) => `${f.code}${f.lastError ? ` (${f.lastError})` : ""}`).join(", ")}`}
          </Banner>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label={strings.outbox.retry}
              variant="secondary"
              size="small"
              accessibilityHint={strings.outbox.retryHint}
              onPress={d.retryFailed}
              style={{ flex: 1 }}
            />
            <Button
              label={strings.outbox.remove}
              variant="danger"
              size="small"
              accessibilityHint={strings.outbox.removeHint}
              onPress={() =>
                Alert.alert(strings.outbox.removeTitle, strings.outbox.removeBody, [
                  { text: strings.outbox.cancel, style: "cancel" },
                  { text: strings.outbox.remove, style: "destructive", onPress: d.removeFailed },
                ])
              }
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}

      {d.verdict ? <VerdictCard verdict={d.verdict} undoOpen={d.undoOpen} onUndo={() => void d.undo()} onDismiss={d.dismiss} /> : null}

      <Button
        label={strings.checkIn.scan}
        accessibilityHint={strings.checkIn.scanHint}
        icon={<ScanLine size={22} color={colors.onPrimary} />}
        onPress={() => {
          d.dismiss();
          setScanning(true);
        }}
        style={{ minHeight: 64 }}
      />

      <Divider />
      <View style={{ gap: space.sm }}>
        <Text variant="label" accessibilityRole="header">
          {strings.checkIn.typeCode}
        </Text>
        <TextField
          label={strings.checkIn.codeField}
          hint={strings.checkIn.codeFieldHint}
          placeholder={strings.checkIn.codePlaceholder}
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
      <View style={{ gap: space.sm }}>
        <Text variant="label" accessibilityRole="header">
          {strings.checkIn.search}
        </Text>
        <GuestSearch door={door} online={online} busy={d.busy} onCheckIn={d.checkInCode} />
      </View>
    </TicketsScreen>
  );
}
