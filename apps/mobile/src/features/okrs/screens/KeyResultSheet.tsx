import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { Button, ChoiceChips, FieldError, ListGroup, ListRow, Sheet, Text, TextField } from "@/components";
import { timeAgo } from "@/features/home/feed-logic";
import { announce } from "@/lib/a11y";
import { hairline, radius, space } from "@/theme/tokens";
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
  const valueError = error === strings.errors.valueNotNumber;

  return (
    <Sheet visible title={kr.label || k.sheetTitle} onClose={onClose}>
      <View style={{ gap: space.lg, paddingBottom: space.sm }}>
        <View style={{ gap: space.sm }}>
          <View style={{ gap: space.xs }}>
            <Text variant="label">{objectiveTitle}</Text>
            <Text>{kr.description}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
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
          <View
            testID="checkin-form"
            style={{
              gap: space.md,
              padding: space.md,
              backgroundColor: colors.surface,
              borderWidth: hairline,
              borderColor: colors.rule,
              borderRadius: radius.card,
            }}
          >
            <Text variant="sectionTitle" accessibilityRole="header">
              {k.newCheckin}
            </Text>
            <ChoiceChips label={k.statusLabel} options={STATUS_OPTIONS} value={status} onChange={setStatus} disabled={busy} />
            {kr.hasMetric ? (
              <TextField
                label={k.valueLabel(kr.metricUnit)}
                hint={k.valueHint(kr.currentValue)}
                error={valueError ? error : null}
                value={value}
                onChangeText={(t) => {
                  setValue(t);
                  if (valueError) setError(null);
                }}
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
            {/* A bad figure is said on its field; anything else (the save failed) above the button. */}
            {error && !valueError ? (
              <View testID="form-error">
                <FieldError>{error}</FieldError>
              </View>
            ) : null}
            <Button label={k.save} variant="primary" loading={busy} onPress={() => void save()} testID="checkin-save" />
          </View>
        ) : (
          <Text tone="secondary" testID="read-only-note">
            {readOnly === "closed" ? k.closed : k.readOnly}
          </Text>
        )}

        <View style={{ gap: space.xs }}>
          <Text variant="label" accessibilityRole="header">
            {k.notes}
          </Text>
          <Text tone={kr.notes ? "default" : "secondary"}>{kr.notes || k.noNotes}</Text>
          {canEdit ? (
            <ListGroup inset={false} style={{ marginTop: space.sm }}>
              <ListRow title={k.editNotesOnWeb} trailing="web" onPress={onEditOnWeb} testID="notes-on-web" />
            </ListGroup>
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="label" accessibilityRole="header">
            {k.history}
          </Text>
          {history.status === "loading" ? (
            <Text tone="secondary" accessibilityLabel={k.historyLoading}>
              {k.historyLoading}
            </Text>
          ) : history.status === "error" ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              <Text tone="secondary">{k.historyError}</Text>
              <Button label={strings.common.tryAgain} variant="secondary" size="small" onPress={() => {
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
      style={{ borderLeftWidth: 2, borderLeftColor: colors.ruleStrong, paddingLeft: 10, gap: space.xs, paddingVertical: 2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
        <StatusTag status={c.status} />
        <Text variant="caption" tone="secondary">
          {meta}
        </Text>
      </View>
      {c.comment ? <Text>{c.comment}</Text> : null}
    </View>
  );
}
