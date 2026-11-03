import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Camera, ImagePlus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Image, Pressable, Switch, View } from "react-native";

import { Banner, Button, Divider, Masthead, Screen, Text, TextField } from "@/components";
import { useSession } from "@/auth/session-provider";
import { apiFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { deleteExpense, deleteReceipt, exchangeRateToZar, listReceipts, updateExpense, userMessage } from "../api";
import { chooseReceiptPhotos, takeReceiptPhoto, type DraftPhoto } from "../capture";
import { OutboxList } from "../components/OutboxList";
import { Sheet } from "../components/Sheet";
import { Chips, ErrorState, Skeleton, Tag } from "../components/ui";
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

  if (state.status === "loading") {
    return (
      <Screen edges={["bottom"]}>
        <Skeleton label={strings.team.loading} rows={6} />
      </Screen>
    );
  }
  if (state.status === "error") {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState title={s.loadError} message={state.message} onRetry={retry} />
      </Screen>
    );
  }
  if (state.data.kind !== "money") {
    return (
      <Screen edges={["bottom"]}>
        <Banner tone="danger" title={s.loadError}>
          {strings.common.forbidden}
        </Banner>
      </Screen>
    );
  }
  const expense = expenseId ? state.data.expenses.find((e) => e.id === expenseId) : undefined;
  if (expenseId && !expense) {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState title={s.loadError} message="This expense isn't there any more. It may have been deleted on the website." onRetry={retry} />
      </Screen>
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
      if (first) AccessibilityInfo.announceForAccessibility(first);
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
        setSaveError(after.lastError ?? "FFSA Hub couldn't save this expense.");
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
            setFlash(teamId, { tone: "positive", message: "Expense deleted." });
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

  return (
    <Screen keyboard edges={["bottom"]}>
      <Masthead context={s.loggingTo(view.team.team_name)} title={isNew ? s.newTitle : s.editTitle} />
      {readOnly ? <Banner tone="info">{s.readOnly}</Banner> : null}

      {/* Budget line */}
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="secondary">
          {s.category}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${s.category}: ${categoryName ?? s.categoryPlaceholder}`}
          accessibilityHint="Opens the list of budget lines"
          accessibilityState={{ disabled: readOnly }}
          disabled={readOnly}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => ({
            minHeight: touch.minTarget,
            justifyContent: "center",
            paddingHorizontal: 12,
            borderWidth: errors.category_id ? 2 : hairline,
            borderColor: errors.category_id ? colors.danger : colors.ruleStrong,
            backgroundColor: pressed ? colors.surface : colors.bg,
          })}
        >
          <Text tone={categoryName ? "default" : "secondary"}>{categoryName ?? s.categoryPlaceholder}</Text>
        </Pressable>
        {errors.category_id ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {errors.category_id}
          </Text>
        ) : null}
      </View>

      {/* Date */}
      <TextField
        label={s.date}
        value={form.expense_date}
        onChangeText={(v) => set("expense_date", v)}
        error={errors.expense_date}
        hint={s.dateHint}
        editable={!readOnly}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
      />
      {!readOnly ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button label={s.today} variant="secondary" onPress={() => set("expense_date", todayIso())} />
          <Button label={s.yesterday} variant="secondary" onPress={() => set("expense_date", shiftIso(todayIso(), -1))} />
        </View>
      ) : null}

      <TextField
        label={s.description}
        value={form.description}
        onChangeText={(v) => set("description", v)}
        error={errors.description}
        placeholder={s.descriptionPlaceholder}
        editable={!readOnly}
      />

      <Chips<PaymentMethod>
        label={s.paymentMethod}
        value={form.payment_method}
        onChange={(v) => set("payment_method", v)}
        disabled={readOnly}
        options={PAYMENT_METHODS.map((m) => ({ value: m, label: strings.paymentMethods[m] }))}
      />

      {/* Amount + currency */}
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 2 }}>
          <TextField
            label={foreign ? `${s.amount} (${form.currency || "?"})` : `${s.amount} (rand)`}
            value={form.amount}
            onChangeText={(v) => set("amount", v)}
            error={errors.amount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            editable={!readOnly}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label={s.currency}
            value={form.currency}
            onChangeText={(v) => set("currency", v)}
            error={errors.currency}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            editable={!readOnly}
            accessibilityHint={s.currencyHint}
          />
        </View>
      </View>
      {!readOnly && view.team.currency !== "ZAR" ? (
        <Chips
          label={s.currency}
          value={form.currency}
          onChange={(v) => set("currency", v)}
          options={[
            { value: "ZAR", label: "ZAR" },
            { value: view.team.currency, label: view.team.currency },
          ]}
        />
      ) : null}

      {foreign ? (
        <View style={{ gap: 8 }}>
          <TextField
            label={zar.fromPull ? s.zarEstimate : cardAbroad ? s.zarFromBank : s.zarAmount}
            value={zar.fromPull ? (zar.zar === null ? "" : zar.zar.toFixed(2)) : form.zar_amount}
            onChangeText={(v) => set("zar_amount", v)}
            error={errors.zar_amount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            editable={!readOnly && zar.editable}
          />
          {pricedByPull ? <Banner tone="info">{pull ? s.pullNote(form.currency) : s.noPullNote(form.currency)}</Banner> : null}
          {!readOnly && zar.editable ? (
            <Button label={s.useTodaysRate} variant="secondary" loading={rateBusy} onPress={useTodaysRate} />
          ) : null}
          {cardAbroad ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: touch.minTarget }}>
              <Switch
                value={form.zar_confirmed}
                onValueChange={(v) => set("zar_confirmed", v)}
                disabled={readOnly}
                accessibilityLabel={s.zarConfirmed}
                accessibilityHint={s.zarConfirmedHint}
                trackColor={{ true: colors.text, false: colors.ruleStrong }}
                thumbColor={colors.bg}
              />
              <View style={{ flex: 1 }}>
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

      <Button label={more ? s.lessDetails : s.moreDetails} variant="ghost" onPress={() => setMore((m) => !m)} accessibilityState={{ expanded: more }} />
      {more ? (
        <View style={{ gap: 16 }}>
          <TextField label={s.vendor} value={form.vendor} onChangeText={(v) => set("vendor", v)} editable={!readOnly} />
          <TextField label={s.purchaser} value={form.purchaser} onChangeText={(v) => set("purchaser", v)} editable={!readOnly} />
          <TextField label={s.receiptCode} value={form.receipt_code} onChangeText={(v) => set("receipt_code", v)} editable={!readOnly} placeholder="e.g. R001" />
          <TextField label={s.country} value={form.country} onChangeText={(v) => set("country", v)} editable={!readOnly} />
          <TextField label={s.notes} value={form.notes} onChangeText={(v) => set("notes", v)} editable={!readOnly} multiline />
        </View>
      ) : null}

      <Divider strong />

      {/* Receipts */}
      <View style={{ gap: 12 }}>
        <Text variant="title">{s.receipts}</Text>

        {receipts.status === "loading" && !isNew ? <Skeleton rows={1} label="Loading receipts" /> : null}
        {receipts.status === "error" ? (
          <Banner tone="danger" action={<Button label={strings.common.tryAgain} variant="secondary" onPress={fetchReceipts} />}>
            {s.receiptsLoadError}
          </Banner>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
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

        {queued.length > 0 ? <OutboxList items={queued} outbox={outbox} /> : null}

        {errors.receipts ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {errors.receipts}
          </Text>
        ) : null}
        {captureError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {captureError}
          </Text>
        ) : null}

        {canEdit ? (
          <View style={{ gap: 8 }}>
            <Button
              label={capturing ? strings.expense.preparingPhoto : s.takePhoto}
              accessibilityHint={s.takePhotoHint}
              icon={<Camera size={18} color={colors.text} />}
              variant="secondary"
              loading={capturing}
              onPress={() => addPhotos("camera")}
            />
            <Button
              label={s.chooseLibrary}
              accessibilityHint={s.chooseLibraryHint}
              icon={<ImagePlus size={18} color={colors.text} />}
              variant="secondary"
              disabled={capturing}
              onPress={() => addPhotos("library")}
            />
          </View>
        ) : null}
      </View>

      {saveError ? (
        <Banner tone="danger" title="Not saved">
          {saveError}
        </Banner>
      ) : null}

      {canEdit ? (
        <View style={{ gap: 12, paddingTop: 8 }}>
          <Button label={saving ? s.saving : isNew ? s.save : s.saveChanges} loading={saving} onPress={save} />
          {!isNew ? <Button label={s.delete} variant="destructive" loading={deleting} onPress={confirmDelete} /> : null}
        </View>
      ) : null}

      {expense ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Text variant="caption" tone="secondary">{`${formatMoney(expense.zar_amount, "ZAR")} on FFSA Hub`}</Text>
          {expense.source === "slack" ? <Tag>{s.fromSlack}</Tag> : null}
        </View>
      ) : null}

      <Sheet visible={sheetOpen} title={s.categorySheetTitle} onClose={() => setSheetOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={s.category}>
          {categories.map((c) => {
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
                  justifyContent: "center",
                  borderBottomWidth: hairline,
                  borderBottomColor: colors.rule,
                  backgroundColor: pressed ? colors.surface : "transparent",
                  borderLeftWidth: selected ? 3 : 0,
                  borderLeftColor: colors.text,
                  paddingLeft: selected ? 9 : 0,
                })}
              >
                <Text variant={selected ? "bodyStrong" : "body"}>{selected ? `${c.name}  ✓` : c.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </Screen>
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
    <View style={{ gap: 4, width: 96 }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
        accessibilityHint="Opens the receipt full screen"
        disabled={!onOpen}
        onPress={onOpen}
        style={{ width: 96, height: 96, borderWidth: hairline, borderColor: colors.ruleStrong, backgroundColor: colors.surface }}
      >
        {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      </Pressable>
      {onRemove ? <Button label={strings.outbox.discard} accessibilityLabel={removeLabel} variant="ghost" onPress={onRemove} /> : null}
    </View>
  );
}
