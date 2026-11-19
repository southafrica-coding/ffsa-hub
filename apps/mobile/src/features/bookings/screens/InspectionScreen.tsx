import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Camera, Image as ImageIcon } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { type BackAction, Banner, Bleed, Button, ChoiceChips, EmptyState, LargeTitleScrollView, ListGroup, ListRow, LoadFailed, PushedPage, SectionTitle, SkeletonList, Text, TextField } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage, useMe } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { loadErrorMessage } from "../api";
import { chooseVehiclePhotos, takeVehiclePhoto, type DraftPhoto } from "../capture";
import { DateTimeField } from "../components/DateTimeField";
import { QueueList } from "../components/QueueList";
import { CheckRow, FormError, Panel, YesNo } from "../components/ui";
import { loadVehicleBooking, type VehicleDetail } from "../data";
import {
  DAMAGE_PANELS,
  emptyInspection,
  INVENTORY_ITEMS,
  inspectionError,
  inspectionPayload,
  purposeLabel,
  type InspectionForm,
  type InspectionKind,
  type PhotoKind,
} from "../logic";
import { useBookingsOutbox } from "../outbox/provider";
import { newFormItem, newPhotoItems, type PhotoItem, type QueueItem } from "../outbox/state";
import { strings } from "../strings";

const t = strings.inspection;

// Only ever called from event handlers (taking a photo, sending the form).
const clock = () => Date.now();

/** The web's link to the rental terms every driver agrees to. */
export const TERMS_URL = "https://docs.google.com/document/d/1rQ8fL4dNhJflIevyMO9GDpsGUWmEtQDXGQTcA53BUQA/edit?usp=sharing";

/** Which photo sections a check shows (the web form's FileSections). */
export function photoSections(kind: InspectionKind, f: Pick<InspectionForm, "washed" | "fuelFull">): PhotoKind[] {
  if (kind === "collection") return ["license", "damage_photo"];
  return [...(f.washed ? (["carwash_receipt"] as const) : []), ...(f.fuelFull ? (["fuel_gauge"] as const) : []), "damage_photo"];
}

/**
 * Photos attached during this visit to the screen, by kind. A photo counts
 * while it waits on the phone AND after it has gone to FFSA Hub; only the
 * person's Remove takes it off. (The upload route files receipts and gauge
 * photos under "damage_photo", as it does for the web, so the server's list
 * can't tell them apart: the count is kept here, as the web form keeps it.)
 */
export function attachedCounts(added: { id: string; kind: PhotoKind }[], removed: Set<string>): Partial<Record<PhotoKind, number>> {
  const out: Partial<Record<PhotoKind, number>> = {};
  for (const a of added) if (!removed.has(a.id)) out[a.kind] = (out[a.kind] ?? 0) + 1;
  return out;
}

export function seedInspection(detail: VehicleDetail): InspectionForm {
  const b = detail.booking;
  return emptyInspection({
    vehicleId: b.assignments.find((a) => a.vehicle)?.vehicle?.id ?? "",
    driverNames: b.drivers.map((d) => d.name).join(", ") || (b.requester_name ?? ""),
    usagePurpose: b.purpose === "other" && b.purpose_note ? b.purpose_note : purposeLabel(b.purpose),
    checkinDate: b.return_date,
  });
}

// The collection or return check (frames 7.5, 7.12, 7.13): the web's
// inspection form as one full-height page (the tab bar is hidden on this
// route). Photos go into the outbox the moment they're taken and show their
// state inline; the form itself is queued the same way.
export default function InspectionScreen({ bookingId, kind }: { bookingId: string; kind: InspectionKind }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const me = useMe();
  const access = useMemo(() => bookingsAccess(me.me), [me.me]);
  const { items, outbox, online } = useBookingsOutbox();

  const load = useCallback(() => loadVehicleBooking(bookingId), [bookingId]);
  const { state, retry } = useCachedLoad<VehicleDetail | null>({
    userId,
    cacheName: `bookings.vehicle.${bookingId}`,
    load,
    errorMessage: loadErrorMessage,
  });

  const [draft, setForm] = useState<InspectionForm | null>(null);
  const [added, setAdded] = useState<{ id: string; kind: PhotoKind }[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const detail = state.status === "ready" ? state.data : null;

  // Seeded from the booking, like the web's collect/return pages, until the person edits it.
  const form = useMemo(() => draft ?? (detail ? seedInspection(detail) : null), [draft, detail]);

  const title = kind === "collection" ? t.collectionTitle : t.returnTitle;
  const back: BackAction = { label: strings.common.booking, onPress: () => router.back() };

  if (state.status === "loading") {
    return (
      <PushedPage back={back}>
        <SkeletonList label={strings.common.loading} count={5} inset={false} />
      </PushedPage>
    );
  }
  if (state.status === "error") {
    return (
      <PushedPage back={back}>
        <LoadFailed title={title} message={state.message} onRetry={retry} />
      </PushedPage>
    );
  }
  if (!detail || !form) {
    return (
      <PushedPage back={back}>
        <EmptyState testID="not-found" title={strings.detail.vehicleContext} body={strings.common.notFound} />
      </PushedPage>
    );
  }

  const b = detail.booking;
  const mayInspect = b.requested_by === userId || access.vehicles.manage;
  if (!mayInspect) {
    return (
      <PushedPage back={back}>
        <EmptyState testID="no-access" title={title} body={t.noAccess} />
      </PushedPage>
    );
  }
  if (detail.inspections.some((i) => i.kind === kind)) {
    return (
      <PushedPage back={back}>
        <EmptyState testID="already" title={title} body={t.alreadyRecorded} />
      </PushedPage>
    );
  }

  const f = form;
  const set = (patch: Partial<InspectionForm>) => {
    setForm({ ...f, ...patch });
    setError(null);
  };
  const counts = attachedCounts(added, removed);
  const sections = photoSections(kind, f);
  const isCollection = kind === "collection";
  const meta = { userId: userId ?? "", bookingId: b.id, bookingName: b.booking_name, inspectionKind: kind };
  const vehicles = b.assignments.map((a) => a.vehicle).filter((v): v is NonNullable<typeof v> => !!v);

  async function addPhotos(photoKind: PhotoKind, source: "camera" | "library") {
    if (!userId) return;
    setCapturing(true);
    try {
      const drafts: DraftPhoto[] = source === "camera" ? await takeVehiclePhoto() : await chooseVehiclePhotos();
      const newItems = newPhotoItems(meta, photoKind, drafts, clock(), Crypto.randomUUID);
      if (newItems.length) {
        // On disk in the outbox before anything tries to send it.
        await outbox.add(...newItems);
        setAdded((prev) => [...prev, ...newItems.map((n) => ({ id: n.id, kind: photoKind }))]);
        setError(null);
        announce(strings.a11y.photoAdded(t.photos[photoKind]));
        void outbox.process();
      }
    } catch {
      setError(t.photoFailed);
    } finally {
      setCapturing(false);
    }
  }

  async function submit() {
    const problem = inspectionError(kind, f, counts);
    if (problem) {
      setError(problem);
      return;
    }
    if (!userId) return;
    setSaving(true);
    setError(null);
    // A form that failed before is replaced, never sent twice.
    for (const old of items) {
      if (old.kind === "form" && old.bookingId === b.id && old.inspectionKind === kind && old.userId === userId) await outbox.discard(old.id);
    }
    const id = Crypto.randomUUID();
    await outbox.add(newFormItem(meta, inspectionPayload(b.id, kind, f), clock(), id));
    await outbox.process();
    setSaving(false);
    const left: QueueItem | undefined = outbox.getItems().find((i) => i.id === id);
    if (!left) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(t.sent);
      // The screen closes at once, so the banner is never seen: say it.
      announce(t.sent);
      router.back();
      return;
    }
    if (left.status === "failed") {
      setError(left.lastError ?? strings.common.generic);
      return;
    }
    // Offline or the server is slow: it's safe on the phone and will go by itself.
    setNotice(t.savedOffline);
    announce(t.savedOffline);
    router.back();
  }

  const photoItemsFor = (k: PhotoKind) =>
    items.filter((i): i is PhotoItem => i.kind === "photo" && i.bookingId === b.id && i.inspectionKind === kind && i.photoKind === k && i.userId === userId);

  const odometer = <TextField label={t.mileage} value={f.mileage} onChangeText={(v) => set({ mileage: v.replace(/[^\d]/g, "") })} keyboardType="number-pad" testID="mileage" />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <LargeTitleScrollView back={back} eyebrow={t.context(b.booking_name)} title={title} edges={["top", "bottom"]} gap={space.lg}>
        {notice ? (
          <Bleed>
            <Banner tone="positive">{notice}</Banner>
          </Bleed>
        ) : null}

        {vehicles.length > 1 ? (
          <ChoiceChips
            label={t.vehicle}
            options={vehicles.map((v) => ({ value: v.id, label: v.registration_plate ? `${v.name}: ${v.registration_plate}` : v.name }))}
            value={f.vehicleId || null}
            onChange={(v) => set({ vehicleId: v })}
          />
        ) : vehicles.length === 1 ? (
          <Text tone="secondary" style={{ marginTop: -space.sm }}>{`${t.vehicle}: ${vehicles[0].name}${vehicles[0].registration_plate ? ` (${vehicles[0].registration_plate})` : ""}`}</Text>
        ) : null}

        {isCollection ? (
          odometer
        ) : (
          // Return: the odometer and the day it came back, side by side when they fit.
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space.md }}>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 140 }}>{odometer}</View>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 140 }}>
              <DateTimeField mode="date" label={t.checkinDate} value={f.checkinDate} onChange={(v) => set({ checkinDate: v })} />
            </View>
          </View>
        )}
        <TextField label={t.drivers} value={f.driverNames} onChangeText={(v) => set({ driverNames: v })} />
        <YesNo label={t.allPresent} hint={t.allPresentHint} value={f.allDriversPresent} onChange={(v) => set({ allDriversPresent: v })} />

        {isCollection ? (
          <>
            <TextField label={t.usage} value={f.usagePurpose} onChangeText={(v) => set({ usagePurpose: v })} />
            <YesNo label={t.saLicence} hint={t.saLicenceHint} value={f.saLicenseConfirmed} onChange={(v) => set({ saLicenseConfirmed: v })} />
            <Bleed style={{ gap: space.md }}>
              <Panel title={t.damage} hint={t.damageHint} testID="damage-panels">
                {DAMAGE_PANELS.map((p) => (
                  <CheckRow
                    key={p.key}
                    label={p.label}
                    checked={f.damagePanels.includes(p.key)}
                    onChange={(on) => set({ damagePanels: on ? [...f.damagePanels, p.key] : f.damagePanels.filter((k) => k !== p.key) })}
                  />
                ))}
              </Panel>
              <Panel title={t.inventory}>
                {INVENTORY_ITEMS.map((i) => (
                  <CheckRow key={i.key} label={i.label} checked={!!f.inventory[i.key]} onChange={(on) => set({ inventory: { ...f.inventory, [i.key]: on } })} />
                ))}
              </Panel>
            </Bleed>
          </>
        ) : (
          <Bleed>
            <Panel title={t.condition}>
              <CheckRow label={t.washed} checked={f.washed} onChange={(v) => set({ washed: v })} testID="washed" />
              <CheckRow label={t.fuelFull} checked={f.fuelFull} onChange={(v) => set({ fuelFull: v })} testID="fuel" />
              <CheckRow label={t.damageReported} checked={f.damageReported} onChange={(v) => set({ damageReported: v })} />
            </Panel>
          </Bleed>
        )}

        {sections.map((k) => (
          <View key={k} style={{ marginTop: -space.lg }} testID={`photos-${k}`}>
            <SectionTitle title={t.photos[k]} meta={String(counts[k] ?? 0)} tight />
            <View style={{ gap: space.sm }}>
              {photoItemsFor(k).length === 0 && !(counts[k] ?? 0) ? <Text tone="secondary">{t.noPhotos}</Text> : null}
              <Bleed>
                <QueueList items={photoItemsFor(k)} outbox={outbox} online={online} showTitle={false} onRemoved={(id) => setRemoved((r) => new Set(r).add(id))} />
              </Bleed>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button
                  label={t.takePhoto}
                  variant="secondary"
                  size="small"
                  icon={<Camera size={20} color={colors.text} />}
                  disabled={capturing}
                  onPress={() => void addPhotos(k, "camera")}
                  accessibilityLabel={`${t.takePhoto}: ${t.photos[k]}`}
                  style={{ flex: 1 }}
                />
                <Button
                  label={t.choosePhoto}
                  variant="text"
                  size="small"
                  icon={<ImageIcon size={20} color={colors.text} />}
                  disabled={capturing}
                  onPress={() => void addPhotos(k, "library")}
                  accessibilityLabel={`${t.choosePhoto}: ${t.photos[k]}`}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        ))}

        <TextField label={t.notes} value={f.notes} onChangeText={(v) => set({ notes: v })} multiline />
        <Bleed style={{ gap: space.md }}>
          <ListGroup inset={false}>
            <ListRow title={t.terms} trailing="web" onPress={() => void openWebPage(TERMS_URL, colors)} />
          </ListGroup>
          {/* The declarations: two more on return, then the one every check ends with. */}
          <Panel>
            {isCollection ? null : <CheckRow label={t.truthful} checked={f.communicatedTruthfully} onChange={(v) => set({ communicatedTruthfully: v })} testID="truthful" />}
            {isCollection ? null : <CheckRow label={t.permission} checked={f.inspectionPermission} onChange={(v) => set({ inspectionPermission: v })} testID="permission" />}
            <CheckRow label={t.agree} checked={f.agreed} onChange={(v) => set({ agreed: v })} testID="agree" />
          </Panel>
        </Bleed>

        <FormError message={error} />
        <Button label={t.submit(kind)} loading={saving} disabled={capturing} onPress={() => void submit()} testID="submit-check" />
      </LargeTitleScrollView>
    </KeyboardAvoidingView>
  );
}
