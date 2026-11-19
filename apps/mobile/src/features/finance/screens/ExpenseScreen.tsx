import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Camera, Check, ImagePlus, RefreshCw, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Banner, Button, LargeTitleScrollView, Sheet, SkeletonList, StatusChip, Text, TextField, Toggle, type BackAction } from "@/components";
import { useSession } from "@/auth/session-provider";
import { announce } from "@/lib/a11y";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { deleteExpense, deleteReceipt, exchangeRateToZar, listReceipts, updateExpense, userMessage } from "../api";
import { chooseReceiptPhotos, takeReceiptPhoto, type DraftPhoto } from "../capture";
import { ChipButton, ChoiceChips, Disclosure, FieldError, FormNavBar, SelectField } from "../components/form-parts";
import { OutboxList } from "../components/OutboxList";
import { Bleed, LoadError, PushedPage } from "../components/parts";
import { loadTeam, type ReadClient, type TeamData, type TeamMoneyView } from "../data";
import {
  PAYMENT_METHODS,
  derivedZar,
  emptyForm,
  formFromExpense,
  isCardAbroad,
  isForeign,
  newestPull,
  parseAmount,
  shiftIso,
  todayIso,
  updateForm,
  validateExpense,
  type ExpenseForm,
  type FieldErrors,
  type PaymentMethod,
} from "../expense-form";
import { setFlash } from "../flash";
import { formatMoney } from "../money";
import { useOutbox } from "../outbox/provider";
import { receiptPath, receiptsFor, type ExpenseItem, type ReceiptItem } from "../outbox/state";
import { fileOutboxStorage } from "../outbox/store";
import { strings } from "../strings";
import type { Expense, Receipt } from "../types";
import { useCachedLoad } from "../use-cached-load";

const db = supabase as unknown as ReadClient;
const s = strings.expense;

/** Add (no expenseId) or view/edit an expense. */
export default function ExpenseScreen({ teamId, expenseId }: { teamId: string; expenseId?: string }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const load = useCallback(() => loadTeam(db, teamId), [teamId]);
  const { state, retry } = useCachedLoad<TeamData>({ userId, cacheName: `team.${teamId}`, load, errorMessage: userMessage });
  const router = useRouter();

  // Before the form can be drawn (loading, error, no access): a way back and the message.
  const shell = (children: ReactNode) =>
    expenseId ? (
      <PushedPage back={{ label: s.backToTeam, onPress: () => router.back() }}>{children}</PushedPage>
    ) : (
      <FormPage title={s.newTitle} onCancel={() => router.back()}>
        {children}
      </FormPage>
    );

  if (state.status === "loading") {
    return shell(
      <Bleed>
        <SkeletonList label={strings.team.loading} count={6} inset={false} />
      </Bleed>,
    );
  }
  if (state.status === "error") {
    return shell(
      <Bleed>
        <LoadError title={s.loadError} message={state.message} onRetry={retry} />
      </Bleed>,
    );
  }
  if (state.data.kind !== "money") {
    return shell(
      <Bleed>
        <Banner tone="error" title={s.loadError}>
          {strings.common.forbidden}
        </Banner>
      </Bleed>,
    );
  }
  const expense = expenseId ? state.data.expenses.find((e) => e.id === expenseId) : undefined;
  if (expenseId && !expense) {
    return shell(
      <Bleed>
        <LoadError title={s.loadError} message={s.gone} onRetry={retry} />
      </Bleed>,
    );
  }
  return <ExpenseFormView view={state.data} teamId={teamId} expense={expense} userId={userId} />;
}

function ExpenseFormView({
  view,
  teamId,
  expense,
  userId,
}: {
  view: TeamMoneyView;
  teamId: string;
  expense?: Expense;
  userId: string | null;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const { outbox, items } = useOutbox();
  const isNew = !expense;
  const canEdit = view.canEdit;

  const [form, setForm] = useState<ExpenseForm>(() =>
    expense ? formFromExpense(expense) : emptyForm({ currency: view.team.currency, country: view.team.country }),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [more, setMore] = useState(Boolean(expense && (expense.vendor || expense.purchaser || expense.receipt_code || expense.notes)));
  const [drafts, setDrafts] = useState<DraftPhoto[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [rateBusy, setRateBusy] = useState(false);

  // Draft photos belong to the form until Save hands them to the outbox. If
  // the person leaves without saving, tidy them away.
  const handedOver = useRef(false);
  const draftsRef = useRef<DraftPhoto[]>([]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(
    () => () => {
      if (handedOver.current) return;
      for (const d of draftsRef.current) {
        try {
          fileOutboxStorage.deleteFile(d.localUri);
        } catch {
          // best effort
        }
      }
    },
    [],
  );

  // ── Existing receipts (edit) ──────────────────────────────────────────────
  const [receipts, setReceipts] = useState<{ status: "idle" | "loading" | "error" | "ready"; list: Receipt[] }>({
    status: isNew ? "idle" : "loading",
    list: [],
  });
  const fetchReceipts = useCallback(async () => {
    if (!expense) return;
    setReceipts((r) => ({ ...r, status: "loading" }));
    try {
      setReceipts({ status: "ready", list: await listReceipts(apiFetch, expense.id) });
    } catch {
      setReceipts((r) => ({ ...r, status: "error" }));
    }
  }, [expense]);
  useEffect(() => {
    if (!expense) return;
    let alive = true;
    listReceipts(apiFetch, expense.id).then(
      (list) => alive && setReceipts({ status: "ready", list }),
      () => alive && setReceipts((r) => ({ ...r, status: "error" })),
    );
    return () => {
      alive = false;
    };
  }, [expense]);
  const queued = expense ? receiptsFor(items, expense.id, userId) : [];

  const categories = useMemo(
    () => [...view.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)),
    [view.categories],
  );
  const categoryName = categories.find((c) => c.id === form.category_id)?.name;
  const zar = derivedZar(form, view.pulls);
  const foreign = isForeign(form);
  const cardAbroad = isCardAbroad(form);
  const pricedByPull = form.payment_method === "cash" && foreign;
  const pull = pricedByPull ? newestPull(view.pulls, form.currency) : undefined;

  function set<K extends keyof ExpenseForm>(field: K, value: ExpenseForm[K]) {
    setForm((f) => updateForm(f, field, value));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  async function addPhotos(source: "camera" | "library") {
    setCaptureError(null);
    setCapturing(true);
    try {
      const photos = source === "camera" ? await takeReceiptPhoto() : await chooseReceiptPhotos();
      if (photos.length === 0) return;
      if (isNew) {
        setDrafts((d) => [...d, ...photos]);
        setErrors((e) => ({ ...e, receipts: undefined }));
      } else if (expense && userId) {
        // The expense exists: queue the photos straight away.
        const now = Date.now();
        await outbox.add(...photos.map((p, i) => receiptItem(p, { teamId, expenseId: expense.id, userId, now: now + i })));
        void outbox.process().then(fetchReceipts);
      }
      void Haptics.selectionAsync().catch(() => {});
    } catch {
      setCaptureError(strings.capture.failed);
    } finally {
      setCapturing(false);
    }
  }

  function removeDraft(d: DraftPhoto) {
    setDrafts((list) => list.filter((x) => x.localUri !== d.localUri));
    try {
      fileOutboxStorage.deleteFile(d.localUri);
    } catch {
      // best effort
    }
  }

  async function useTodaysRate() {
    const amount = parseAmount(form.amount);
    if (amount === null) {
      setErrors((e) => ({ ...e, amount: strings.validation.amount }));
      return;
    }
    setRateBusy(true);
    try {
      const rate = await exchangeRateToZar(apiFetch, form.currency);
      set("zar_amount", (amount * rate).toFixed(2));
    } catch {
      setErrors((e) => ({ ...e, zar_amount: s.rateFailed }));
    } finally {
      setRateBusy(false);
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save() {
    setSaveError(null);
    const v = validateExpense(form, { teamId, pulls: view.pulls, receiptCount: drafts.length, isNew });
    if (!v.ok) {
      setErrors(v.errors);
      const first = Object.values(v.errors).find(Boolean);
      if (first) announce(first);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    setSaving(true);
    try {
      if (!isNew && expense) {
        await updateExpense(apiFetch, expense.id, v.payload);
        setFlash(teamId, { tone: "positive", message: s.savedOnline });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.back();
        return;
      }
      if (!userId) {
        setSaveError(strings.common.signedOut);
        return;
      }
      // New: into the outbox first (on disk), then try to send at once. A
      // client-chosen id lets the server recognise a retried save.
      const expenseId = Crypto.randomUUID();
      const now = Date.now();
      const item: ExpenseItem = {
        kind: "expense",
        id: expenseId,
        userId,
        teamId,
        status: "waiting",
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        createdAt: now,
        payload: v.payload,
      };
      handedOver.current = true;
      await outbox.add(item, ...drafts.map((d, i) => receiptItem(d, { teamId, expenseId, userId, now: now + i + 1 })));
      await outbox.process();
      const after = outbox.getItems().find((i) => i.id === expenseId);
      if (after?.status === "failed") {
        // The server said no (permission or bad data): nothing was saved.
        // Take it back out of the outbox, keep the photos on the form.
        await outbox.discard(expenseId, { keepFiles: true });
        handedOver.current = false;
        setSaveError(after.lastError ?? s.saveFailed);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      const left = receiptsFor(outbox.getItems(), expenseId, userId).length;
      setFlash(
        teamId,
        after
          ? { tone: "info", message: s.savedOffline }
          : { tone: "positive", message: left ? `${s.savedOnline} ${strings.outbox.pendingReceipts(left)}.` : s.savedOnline },
      );
      void Haptics.notificationAsync(after ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (err) {
      setSaveError(userMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!expense) return;
    Alert.alert(s.deleteConfirmTitle, s.deleteConfirmBody, [
      { text: s.cancel, style: "cancel" },
      {
        text: s.delete,
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteExpense(apiFetch, expense.id);
            setFlash(teamId, { tone: "positive", message: s.deleted });
            router.back();
          } catch (err) {
            setSaveError(userMessage(err));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  function confirmDeleteReceipt(r: Receipt) {
    Alert.alert(s.deleteReceiptConfirm, r.file_name, [
      { text: s.cancel, style: "cancel" },
      {
        text: s.deleteReceipt,
        style: "destructive",
        onPress: async () => {
          try {
            await deleteReceipt(apiFetch, r.id);
            await fetchReceipts();
          } catch (err) {
            setSaveError(userMessage(err));
          }
        },
      },
    ]);
  }

  const openViewer = (uri: string, title: string) => router.push({ pathname: "/finance/receipt", params: { uri, title } });
  const readOnly = !canEdit;
  // Two fields side by side, unless the text is large or the phone narrow: then they stack.
  const sideBySide = fontScale <= 1.3 && width >= 340;
  const pair = (a: ReactNode, b: ReactNode, weights: [number, number] = [1, 1]) =>
    sideBySide ? (
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
        <View style={{ flex: weights[0], minWidth: 0 }}>{a}</View>
        <View style={{ flex: weights[1], minWidth: 0 }}>{b}</View>
      </View>
    ) : (
      <View style={{ gap: space.lg }}>
        {a}
        {b}
      </View>
    );
  const receiptTotal = receipts.list.length + drafts.length;

  const body = (
    <>
      {readOnly ? (
        <Bleed>
          <Banner tone="info">{s.readOnly}</Banner>
        </Bleed>
      ) : null}

      <View style={{ gap: space.sm }}>
        {pair(
          <SelectField
            label={s.category}
            value={categoryName}
            placeholder={s.categoryPlaceholder}
            error={errors.category_id}
            disabled={readOnly}
            accessibilityHint={s.categoryHint}
            onPress={() => setSheetOpen(true)}
          />,
          <TextField
            label={s.date}
            value={form.expense_date}
            onChangeText={(v) => set("expense_date", v)}
            error={errors.expense_date}
            accessibilityHint={errors.expense_date ?? s.dateHint}
            editable={!readOnly}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            maxLength={10}
          />,
        )}
        {!readOnly ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <ChipButton label={s.today} accessibilityHint={strings.a11y.todayHint} onPress={() => set("expense_date", todayIso())} />
            <ChipButton label={s.yesterday} accessibilityHint={strings.a11y.yesterdayHint} onPress={() => set("expense_date", shiftIso(todayIso(), -1))} />
          </View>
        ) : null}
      </View>

      <TextField
        label={s.description}
        value={form.description}
        onChangeText={(v) => set("description", v)}
        error={errors.description}
        placeholder={s.descriptionPlaceholder}
        editable={!readOnly}
      />

      <ChoiceChips<PaymentMethod>
        label={s.paymentMethod}
        value={form.payment_method}
        onChange={(v) => set("payment_method", v)}
        disabled={readOnly}
        options={PAYMENT_METHODS.map((m) => ({ value: m, label: strings.paymentMethods[m] }))}
      />

      {/* Amount + currency */}
      <View style={{ gap: space.sm }}>
        {pair(
          <TextField
            label={foreign ? `${s.amount} (${form.currency || "?"})` : `${s.amount} (rand)`}
            value={form.amount}
            onChangeText={(v) => set("amount", v)}
            error={errors.amount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            editable={!readOnly}
          />,
          <TextField
            label={s.currency}
            value={form.currency}
            onChangeText={(v) => set("currency", v)}
            error={errors.currency}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            editable={!readOnly}
            accessibilityHint={errors.currency ?? s.currencyHint}
          />,
          [2, 1],
        )}
        {!readOnly && view.team.currency !== "ZAR" ? (
          <ChoiceChips
            label={s.currency}
            labelPlacement="hidden"
            value={form.currency}
            onChange={(v) => set("currency", v)}
            options={[
              { value: "ZAR", label: "ZAR" },
              { value: view.team.currency, label: view.team.currency },
            ]}
          />
        ) : null}
      </View>

      {foreign ? (
        <View style={{ gap: space.md }}>
          <TextField
            label={zar.fromPull ? s.zarEstimate : cardAbroad ? s.zarFromBank : s.zarAmount}
            value={zar.fromPull ? (zar.zar === null ? "" : zar.zar.toFixed(2)) : form.zar_amount}
            onChangeText={(v) => set("zar_amount", v)}
            error={errors.zar_amount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            editable={!readOnly && zar.editable}
          />
          {pricedByPull ? (
            <Bleed>
              <Banner tone="info">{pull ? s.pullNote(form.currency) : s.noPullNote(form.currency)}</Banner>
            </Bleed>
          ) : null}
          {!readOnly && zar.editable ? (
            <Button
              label={s.useTodaysRate}
              variant="secondary"
              size="small"
              icon={<RefreshCw size={18} color={colors.text} />}
              loading={rateBusy}
              onPress={useTodaysRate}
              style={{ alignSelf: "flex-start" }}
            />
          ) : null}
          {cardAbroad ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: touch.floor }}>
              <Toggle
                value={form.zar_confirmed}
                onValueChange={(v) => set("zar_confirmed", v)}
                disabled={readOnly}
                accessibilityLabel={s.zarConfirmed}
                accessibilityHint={s.zarConfirmedHint}
              />
              <View style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Text>{s.zarConfirmed}</Text>
                {!form.zar_confirmed ? (
                  <Text variant="caption" tone="secondary">
                    {s.zarConfirmedHint}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <Disclosure
        label={more ? s.lessDetails : s.moreDetails}
        expanded={more}
        accessibilityHint={strings.a11y.moreDetailsHint}
        onPress={() => setMore((m) => !m)}
      />
      {more ? (
        <>
          {pair(
            <TextField label={s.vendor} value={form.vendor} onChangeText={(v) => set("vendor", v)} editable={!readOnly} />,
            <TextField label={s.purchaser} value={form.purchaser} onChangeText={(v) => set("purchaser", v)} editable={!readOnly} />,
          )}
          {pair(
            <TextField
              label={s.receiptCode}
              value={form.receipt_code}
              onChangeText={(v) => set("receipt_code", v)}
              editable={!readOnly}
              placeholder={s.receiptCodePlaceholder}
            />,
            <TextField label={s.country} value={form.country} onChangeText={(v) => set("country", v)} editable={!readOnly} />,
          )}
          <TextField label={s.notes} value={form.notes} onChangeText={(v) => set("notes", v)} editable={!readOnly} multiline />
        </>
      ) : null}

      {/* Receipts */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
          <Text variant="label" accessibilityRole="header">
            {s.receipts}
          </Text>
          {receiptTotal > 0 ? <Text variant="label">{s.receiptCount(receiptTotal)}</Text> : null}
        </View>

        {receipts.status === "loading" && !isNew ? <SkeletonList count={1} label={strings.a11y.loadingReceipts} inset={false} /> : null}
        {receipts.status === "error" ? (
          <Bleed>
            <Banner tone="error" actionLabel={strings.common.tryAgain} onAction={fetchReceipts}>
              {s.receiptsLoadError}
            </Banner>
          </Bleed>
        ) : null}

        {receiptTotal > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {receipts.list.map((r, idx) => (
              <Thumb
                key={r.id}
                uri={r.signed_url}
                label={s.viewReceipt(idx + 1)}
                onOpen={r.signed_url ? () => openViewer(r.signed_url as string, r.file_name) : undefined}
                onRemove={canEdit ? () => confirmDeleteReceipt(r) : undefined}
                removeLabel={`${s.deleteReceipt} ${idx + 1}`}
              />
            ))}
            {drafts.map((d, idx) => (
              <Thumb
                key={d.localUri}
                uri={d.localUri}
                label={s.viewReceipt(idx + 1)}
                onOpen={() => openViewer(d.localUri, d.fileName)}
                onRemove={() => removeDraft(d)}
                removeLabel={s.removePhoto(idx + 1)}
              />
            ))}
          </View>
        ) : null}

        {queued.length > 0 ? (
          <Bleed>
            <OutboxList items={queued} outbox={outbox} />
          </Bleed>
        ) : null}

        {errors.receipts ? <FieldError>{errors.receipts}</FieldError> : null}
        {captureError ? <FieldError>{captureError}</FieldError> : null}

        {canEdit ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Button
              label={capturing ? strings.expense.preparingPhoto : s.takePhoto}
              accessibilityHint={s.takePhotoHint}
              icon={<Camera size={18} color={colors.text} />}
              variant="secondary"
              size="small"
              loading={capturing}
              onPress={() => addPhotos("camera")}
              style={{ flexGrow: 1, flexBasis: 150 }}
            />
            <Button
              label={s.chooseLibrary}
              accessibilityHint={s.chooseLibraryHint}
              icon={<ImagePlus size={18} color={colors.text} />}
              variant="secondary"
              size="small"
              disabled={capturing}
              onPress={() => addPhotos("library")}
              style={{ flexGrow: 1, flexBasis: 150 }}
            />
          </View>
        ) : null}
      </View>

      {saveError ? (
        <Bleed>
          <Banner tone="error" title={s.notSaved}>
            {saveError}
          </Banner>
        </Bleed>
      ) : null}

      {canEdit ? (
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          <Button label={saving ? s.saving : isNew ? s.save : s.saveChanges} loading={saving} onPress={save} />
          {!isNew ? (
            <Button label={s.delete} variant="danger" icon={<Trash2 size={18} color={colors.danger} />} loading={deleting} onPress={confirmDelete} />
          ) : null}
        </View>
      ) : null}

      {expense ? (
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", alignItems: "center" }}>
          <Text variant="caption" tone="secondary">
            {s.onHub(formatMoney(expense.zar_amount, "ZAR"))}
          </Text>
          {expense.source === "slack" ? <StatusChip label={s.fromSlack} variant="quiet" icon={null} /> : null}
        </View>
      ) : null}

      <Sheet visible={sheetOpen} title={s.categorySheetTitle} onClose={() => setSheetOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={s.category}>
          {categories.map((c, idx) => {
            const selected = c.id === form.category_id;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityLabel={c.name}
                accessibilityState={{ selected, checked: selected }}
                onPress={() => {
                  set("category_id", c.id);
                  setSheetOpen(false);
                }}
                style={({ pressed }) => ({
                  minHeight: touch.minTarget,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.md,
                  paddingVertical: space.sm,
                  borderTopWidth: idx > 0 ? hairline : 0,
                  borderTopColor: colors.rule,
                  backgroundColor: pressed ? colors.surface : "transparent",
                })}
              >
                {/* Chosen = bold with a tick, not colour. */}
                <Text variant={selected ? "rowTitle" : "body"} style={{ flex: 1 }}>
                  {c.name}
                </Text>
                {selected ? <Check size={20} color={colors.text} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );

  if (isNew) {
    return (
      <FormPage title={s.newTitle} onCancel={() => router.back()}>
        <Text variant="label">{s.loggingTo(view.team.team_name)}</Text>
        {body}
      </FormPage>
    );
  }
  const back: BackAction = { label: view.team.team_name, onPress: () => router.back() };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <LargeTitleScrollView back={back} eyebrow={s.loggingTo(view.team.team_name)} title={s.editTitle} tick={false}>
        {body}
      </LargeTitleScrollView>
    </KeyboardAvoidingView>
  );
}

/** Add expense: a full-height pushed form with Cancel and the title in the bar (the tab bar is hidden). */
function FormPage({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.gutter }}>
        <FormNavBar title={title} cancelLabel={s.cancel} onCancel={onCancel} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.xl, gap: space.lg }}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function receiptItem(p: DraftPhoto, o: { teamId: string; expenseId: string; userId: string; now: number }): ReceiptItem {
  return {
    kind: "receipt",
    id: Crypto.randomUUID(),
    userId: o.userId,
    teamId: o.teamId,
    expenseId: o.expenseId,
    status: "waiting",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: o.now,
    localUri: p.localUri,
    fileName: p.fileName,
    fileSize: p.fileSize,
    mimeType: p.mimeType,
    filePath: receiptPath(o.teamId, o.expenseId, p.fileName, o.now),
    fileUploaded: false,
  };
}

function Thumb({
  uri,
  label,
  onOpen,
  onRemove,
  removeLabel,
}: {
  uri: string | null;
  label: string;
  onOpen?: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center" }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
        accessibilityHint={s.viewReceiptHint}
        accessibilityState={{ disabled: !onOpen }}
        disabled={!onOpen}
        onPress={onOpen}
        style={{
          width: 72,
          height: 72,
          borderRadius: radius.control,
          borderWidth: hairline,
          borderColor: colors.rule,
          backgroundColor: colors.surface,
          overflow: "hidden",
        }}
      >
        {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      </Pressable>
      {onRemove ? <Button label={strings.outbox.discard} accessibilityLabel={removeLabel} variant="text" onPress={onRemove} /> : null}
    </View>
  );
}
