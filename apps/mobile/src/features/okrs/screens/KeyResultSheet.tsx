import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { Button, Text, TextField } from "@/components";
import { Sheet } from "@/features/finance/components/Sheet";
import { Chips } from "@/features/finance/components/ui";
import { timeAgo } from "@/features/home/feed-logic";
import { ListRow } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { useTheme } from "@/theme/use-theme";

import { okrsApi } from "../client";
import { Bar, StatusTag } from "../components/ui";
import { STATUS_OPTIONS, buildCheckin, formatDay, saveErrorMessage, statusLabel } from "../logic";
import { strings } from "../strings";
import type { Checkin, KeyResult, OkrStatus } from "../types";

const k = strings.kr;

type History = { status: "loading" } | { status: "error" } | { status: "ready"; checkins: Checkin[] };

/**
 * One key result in a bottom sheet: what it is, where it stands, its notes
 * and its check-in history. For the group's leaders on the current cycle it
 * also has the website's check-in form (status, figure if tracked, what
 * changed), posted to the existing /api/okrs/key-results/[id]/checkins. A
 * check-in is the only way a key result's status moves, as on the web.
 * Give it key={keyResult.id} so each one opens clean.
 */
export function KeyResultSheet({
  keyResult: kr,
  objectiveTitle,
  canEdit,
  readOnly,
  onClose,
  onSaved,
  onEditOnWeb,
}: {
  keyResult: KeyResult;
  objectiveTitle: string;
  canEdit: boolean;
  readOnly: "closed" | "read_access" | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onEditOnWeb: () => void;
}) {
  const { colors } = useTheme();
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [status, setStatus] = useState<OkrStatus>(kr.status);
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Starts in "loading"; a retry sets that itself, so the effect never sets state synchronously.
  const loadHistory = useCallback((signal?: AbortSignal) => {
    return okrsApi.loadCheckins(kr.id, signal).then(
      (checkins) => {
        if (!signal?.aborted) setHistory({ status: "ready", checkins });
      },
      () => {
        if (!signal?.aborted) setHistory({ status: "error" });
      },
    );
  }, [kr.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  useEffect(() => {
    if (error && Platform.OS === "ios") announce(error);
  }, [error]);

  async function save() {
    const built = buildCheckin({ status, value, comment, hasMetric: kr.hasMetric });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await okrsApi.postCheckin(kr.id, built.body);
    } catch (err) {
      setBusy(false);
      setError(saveErrorMessage(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    setBusy(false);
    setValue("");
    setComment("");
    announce(k.saved);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void loadHistory();
    await onSaved();
  }

  const ago = kr.lastCheckinAt ? timeAgo(kr.lastCheckinAt) : null;

  return (
    <Sheet visible title={kr.label || k.sheetTitle} onClose={onClose}>
      <View style={{ gap: 16, paddingBottom: 8 }}>
        <View style={{ gap: 8 }}>
          <Text variant="monoLabel" tone="secondary">
            {objectiveTitle}
          </Text>
          <Text>{kr.description}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <StatusTag status={kr.status} testID="sheet-status" />
            <Text variant="caption" tone="secondary">
              {ago ? strings.owner.updated(ago) : strings.owner.neverUpdated}
            </Text>
          </View>
          {kr.progressPct !== null ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={[kr.caption, strings.owner.progress(kr.progressPct)].filter(Boolean).join(", ")}
              accessibilityValue={{ min: 0, max: 100, now: kr.progressPct }}
              style={{ gap: 4 }}
            >
              <Bar pct={kr.progressPct} />
              {kr.caption ? (
                <Text variant="caption" tone="secondary">
                  {kr.caption}
                </Text>
              ) : null}
            </View>
          ) : null}
          {kr.ownerNote ? (
            <Text variant="caption" tone="secondary">
              {k.carrying(kr.ownerNote)}
            </Text>
          ) : null}
        </View>

        {canEdit ? (
          <View testID="checkin-form" style={{ gap: 12, padding: 12, backgroundColor: colors.surface }}>
            <Text variant="monoLabel" accessibilityRole="header">
              {k.newCheckin}
            </Text>
            <Chips label={k.statusLabel} options={STATUS_OPTIONS} value={status} onChange={setStatus} disabled={busy} />
            {kr.hasMetric ? (
              <TextField
                label={k.valueLabel(kr.metricUnit)}
                hint={k.valueHint(kr.currentValue)}
                value={value}
                onChangeText={setValue}
                keyboardType="decimal-pad"
                placeholder={kr.currentValue !== null ? String(kr.currentValue) : undefined}
                editable={!busy}
                testID="checkin-value"
              />
            ) : null}
            <TextField
              label={k.commentLabel}
              hint={k.commentHint}
              value={comment}
              onChangeText={setComment}
              multiline
              editable={!busy}
              testID="checkin-comment"
            />
            {error ? (
              <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="form-error">
                {error}
              </Text>
            ) : null}
            <Button label={k.save} variant="primary" loading={busy} onPress={() => void save()} testID="checkin-save" />
          </View>
        ) : (
          <Text tone="secondary" testID="read-only-note">
            {readOnly === "closed" ? k.closed : k.readOnly}
          </Text>
        )}

        <View style={{ gap: 6 }}>
          <Text variant="monoLabel" tone="secondary" accessibilityRole="header">
            {k.notes}
          </Text>
          <Text tone={kr.notes ? "default" : "secondary"}>{kr.notes || k.noNotes}</Text>
          {canEdit ? <ListRow title={k.editNotesOnWeb} trailing="web" onPress={onEditOnWeb} testID="notes-on-web" /> : null}
        </View>

        <View style={{ gap: 8 }}>
          <Text variant="monoLabel" tone="secondary" accessibilityRole="header">
            {k.history}
          </Text>
          {history.status === "loading" ? (
            <Text tone="secondary" accessibilityLabel={k.historyLoading}>
              {k.historyLoading}
            </Text>
          ) : history.status === "error" ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              <Text tone="secondary">{k.historyError}</Text>
              <Button label={strings.common.tryAgain} variant="secondary" onPress={() => {
                  setHistory({ status: "loading" });
                  void loadHistory();
                }}
                testID="history-retry" />
            </View>
          ) : history.checkins.length === 0 ? (
            <Text tone="secondary" testID="history-empty">
              {k.historyEmpty}
            </Text>
          ) : (
            history.checkins.map((c) => <CheckinItem key={c.id} checkin={c} />)
          )}
        </View>
      </View>
    </Sheet>
  );
}

function CheckinItem({ checkin: c }: { checkin: Checkin }) {
  const { colors } = useTheme();
  // checkin_on, not created_at: the date the author meant.
  const meta = [
    formatDay(c.checkin_on),
    c.author_name ? k.historyAuthor(c.author_name) : null,
    c.value !== null ? k.historyValue(String(c.value)) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View
      accessible
      accessibilityLabel={[statusLabel(c.status), meta, c.comment].filter(Boolean).join(". ")}
      testID={`checkin-${c.id}`}
      style={{ borderLeftWidth: 2, borderLeftColor: colors.ruleStrong, paddingLeft: 10, gap: 4, paddingVertical: 2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <StatusTag status={c.status} />
        <Text variant="caption" tone="secondary">
          {meta}
        </Text>
      </View>
      {c.comment ? <Text>{c.comment}</Text> : null}
    </View>
  );
}
