import * as Haptics from "expo-haptics";
import { Globe } from "lucide-react-native";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { View } from "react-native";

import { Banner, Button, ListRow, Sheet, StatusChip, Text, TextField } from "@/components";
import { BulletList, Group, GroupSkeleton, InfoCard, Section } from "@/features/me/components/me-kit";
import { MePage } from "@/features/me/components/MePage";
import { ACCOUNT_DELETION_URL } from "@/features/me/links";
import { openWebPage } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { useTheme } from "@/theme/use-theme";

import { cancelDeletion, getDeletionRequest, requestDeletion, type DeletionStatus } from "./api";
import {
  classifyError,
  deletionReducer,
  formatRequestedDate,
  initialDeletionState,
  isBusy,
  type ErrorKind,
} from "./logic";
import { FALLBACK_CONTACT_EMAIL, strings as s } from "./strings";

// 401 / deactivated are the shared client's business: it signs the person
// out. Nothing to show here.
function isSignOut(err: unknown) {
  return err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated");
}

// Me → Request account deletion. Explains what happens and what is kept,
// takes an optional reason, and sends the request only after a confirm sheet
// (never one tap). The request reaches a person; nothing is deleted here and
// the person stays signed in.
export function DeleteAccountScreen() {
  const { colors } = useTheme();
  const [state, dispatch] = useReducer(deletionReducer, initialDeletionState);
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState(FALLBACK_CONTACT_EMAIL);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const onLoaded = useCallback((res: DeletionStatus) => {
    if (res.contactEmail) setContact(res.contactEmail);
    dispatch({ type: "loaded", request: res.request });
  }, []);

  const onLoadFailed = useCallback((err: unknown) => {
    if (isSignOut(err)) return;
    dispatch({ type: "loadFailed", error: classifyError(err) });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getDeletionRequest(apiFetch, { signal: controller.signal }).then(
      (res) => !controller.signal.aborted && onLoaded(res),
      (err: unknown) => !controller.signal.aborted && onLoadFailed(err),
    );
    return () => controller.abort();
  }, [attempt, onLoaded, onLoadFailed]);

  async function refresh() {
    if (isBusy(state)) return;
    setRefreshing(true);
    await getDeletionRequest(apiFetch).then(onLoaded, onLoadFailed);
    if (alive.current) setRefreshing(false);
  }

  async function submit() {
    dispatch({ type: "submit" });
    try {
      const res = await requestDeletion(apiFetch, reason);
      if (!alive.current) return;
      if (res.contactEmail) setContact(res.contactEmail);
      if (res.request) dispatch({ type: "submitted", request: res.request });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      if (!alive.current || isSignOut(err)) return;
      dispatch({ type: "submitFailed", error: classifyError(err) });
    }
  }

  async function cancel() {
    dispatch({ type: "cancel" });
    try {
      await cancelDeletion(apiFetch);
      if (!alive.current) return;
      setReason("");
      dispatch({ type: "cancelled" });
    } catch (err) {
      if (!alive.current || isSignOut(err)) return;
      dispatch({ type: "cancelFailed", error: classifyError(err) });
    }
  }

  const errorText = (kind: ErrorKind) => s.errors[kind](contact);
  const busy = isBusy(state);

  const requested = state.kind === "requested";
  const requestedDate = requested ? formatRequestedDate(state.request.requestedAt) : "";

  return (
    <MePage title={s.title} refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={{ gap: 16 }}>
        {requested ? (
          <View testID="deletion-requested" style={{ gap: 12 }}>
            <InfoCard>
              <StatusChip label={s.requested.title} variant="positive" />
              <Text>{requestedDate ? s.requested.body(requestedDate) : s.requested.bodyNoDate}</Text>
              {state.request.recorded ? null : (
                <Text variant="caption" tone="secondary">
                  {s.requested.emailedOnly}
                </Text>
              )}
              {state.justSent ? (
                <Text variant="caption" tone="secondary">
                  {s.requested.sentNow}
                </Text>
              ) : null}
              <Button
                testID="deletion-cancel"
                label={s.requested.cancel}
                variant="secondary"
                size="small"
                accessibilityHint={s.requested.cancelHint}
                disabled={busy}
                onPress={() => dispatch({ type: "openCancel" })}
                style={{ alignSelf: "flex-start" }}
              />
            </InfoCard>
            {state.error ? (
              <Banner testID="deletion-error" tone="error" title={s.cancelErrorTitle}>
                {errorText(state.error)}
              </Banner>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <Text>{s.intro}</Text>
          <Text variant="caption" tone="secondary">
            {s.staysActive}
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <Text variant="sectionTitle" accessibilityRole="header">
            {s.deleteHeading}
          </Text>
          <BulletList items={s.deleteItems} />
        </View>

        <View style={{ gap: 6 }}>
          <Text variant="sectionTitle" accessibilityRole="header">
            {s.keepHeading}
          </Text>
          <Text variant="caption" tone="secondary">
            {s.keepIntro}
          </Text>
          <BulletList items={s.keepItems} />
        </View>
      </View>

      {requested ? null : (
        <>
          <Section title={s.requestHeading} />
          <View style={{ gap: 16 }}>
            {state.kind === "loading" ? <GroupSkeleton count={2} label={s.loading} /> : null}

            {state.kind === "loadError" ? (
              <Banner
                testID="deletion-load-error"
                tone="error"
                title={s.loadErrorTitle}
                actionLabel={s.retry}
                onAction={() => {
                  dispatch({ type: "load" });
                  setAttempt((n) => n + 1);
                }}
              >
                {errorText(state.error)}
              </Banner>
            ) : null}

            {state.kind === "none" ? (
              <View testID="deletion-none" style={{ gap: 16 }}>
                {state.error ? (
                  <Banner testID="deletion-error" tone="error" title={s.errorTitle}>
                    {errorText(state.error)}
                  </Banner>
                ) : null}
                <TextField
                  testID="deletion-reason"
                  label={s.reason.label}
                  hint={s.reason.hint}
                  placeholder={s.reason.placeholder}
                  value={reason}
                  onChangeText={setReason}
                  maxLength={1000}
                  multiline
                  editable={!busy}
                  textAlignVertical="top"
                  style={{ minHeight: 96 }}
                />
                <Button
                  testID="deletion-request"
                  label={s.request.button}
                  variant="danger"
                  accessibilityHint={s.request.hint}
                  disabled={busy}
                  onPress={() => dispatch({ type: "openConfirm" })}
                />
              </View>
            ) : null}
          </View>
        </>
      )}

      <Group style={{ marginTop: 16 }}>
        <ListRow
          testID="deletion-web"
          icon={Globe}
          title={s.web.title}
          subtitle={s.web.subtitle}
          trailing="web"
          onPress={() => void openWebPage(ACCOUNT_DELETION_URL, colors)}
        />
      </Group>

      <Sheet
        visible={state.kind === "none" && (state.step === "confirming" || state.step === "requesting")}
        title={s.confirm.title}
        onClose={() => dispatch({ type: "closeConfirm" })}
      >
        <Text tone="secondary">{s.confirm.body}</Text>
        <View style={{ gap: 8 }}>
          <Button
            testID="deletion-confirm"
            label={s.confirm.yes}
            variant="dangerFill"
            accessibilityHint={s.confirm.yesHint}
            loading={state.kind === "none" && state.step === "requesting"}
            onPress={() => void submit()}
          />
          <Button label={s.confirm.no} variant="secondary" disabled={busy} onPress={() => dispatch({ type: "closeConfirm" })} />
        </View>
      </Sheet>

      <Sheet
        visible={state.kind === "requested" && (state.step === "confirmingCancel" || state.step === "cancelling")}
        title={s.cancelConfirm.title}
        onClose={() => dispatch({ type: "closeCancel" })}
      >
        <Text tone="secondary">{s.cancelConfirm.body}</Text>
        <View style={{ gap: 8 }}>
          <Button
            testID="deletion-cancel-confirm"
            label={s.cancelConfirm.yes}
            variant="primary"
            loading={state.kind === "requested" && state.step === "cancelling"}
            onPress={() => void cancel()}
          />
          <Button label={s.cancelConfirm.no} variant="secondary" disabled={busy} onPress={() => dispatch({ type: "closeCancel" })} />
        </View>
      </Sheet>
    </MePage>
  );
}
