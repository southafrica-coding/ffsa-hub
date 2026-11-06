import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Alert, View } from "react-native";

import { Button, Text, TextField } from "@/components";
import { FormError } from "@/features/bookings/components/ui";
import { Chips } from "@/features/finance/components/ui";
import { Sheet } from "@/features/finance/components/Sheet";
import { announce } from "@/lib/a11y";
import { apiFetch } from "@/lib/api-client";

import { actionErrorMessage, makeStaff, recordDecision, type DepartmentOption, type StaffDecisionRow } from "../api";
import { decisionProblem, departmentLabel, offerMakeStaffAfterSave } from "../logic";
import { strings } from "../strings";

const sh = strings.sheet;

export type SheetStep = "decide" | "make-staff";

const LATER = "__later__";

/**
 * Record (or change) one student's staff decision, then, after a yes for
 * someone with a Hub account who isn't staff yet, offer to make them staff,
 * the same two steps as the web dialog. A "no" needs a note. Making someone
 * staff asks for confirmation first. The sheet stays open on failure so the
 * reason is read where the person acted. Render it only while a row is
 * open, with key={row.enrollmentId + step} so each opening starts clean.
 */
export function DecisionSheet({
  row,
  initialStep,
  departmentOptions,
  onClose,
  onChanged,
}: {
  row: StaffDecisionRow;
  initialStep: SheetStep;
  departmentOptions: DepartmentOption[];
  onClose: () => void;
  /** Reload the list after a save; awaited so the rows are fresh when the sheet closes. */
  onChanged: () => Promise<void>;
}) {
  const [step, setStep] = useState<SheetStep>(initialStep);
  const [accepted, setAccepted] = useState<boolean | null>(row.decision ? row.decision.accepted : null);
  const [note, setNote] = useState(row.decision?.note ?? "");
  const [department, setDepartment] = useState<string>(row.department ?? LATER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noteRequired = accepted === false;

  async function save() {
    const problem = decisionProblem(accepted, note);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordDecision(apiFetch, { enrollmentId: row.enrollmentId, accepted: accepted === true, note });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      announce(sh.saved(row.name));
      await onChanged();
      if (offerMakeStaffAfterSave(row, accepted === true)) setStep("make-staff");
      else onClose();
    } catch (err) {
      setError(actionErrorMessage(err, "decide"));
    } finally {
      setBusy(false);
    }
  }

  async function doMakeStaff(dept: string | null) {
    setBusy(true);
    setError(null);
    try {
      await makeStaff(apiFetch, { enrollmentId: row.enrollmentId, department: dept });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      announce(sh.madeStaff(row.name));
      await onChanged();
      onClose();
    } catch (err) {
      setError(actionErrorMessage(err, "makeStaff"));
    } finally {
      setBusy(false);
    }
  }

  function confirmMakeStaff() {
    const dept = department === LATER ? null : department;
    Alert.alert(sh.confirmTitle(row.name), sh.confirmBody(departmentLabel(departmentOptions, dept)), [
      { text: sh.confirmNo, style: "cancel" },
      { text: sh.confirmYes, onPress: () => void doMakeStaff(dept) },
    ]);
  }

  if (step === "make-staff") {
    return (
      <Sheet visible title={sh.makeStaffTitle(row.name)} onClose={onClose}>
        <View style={{ gap: 12, paddingBottom: 8 }} testID="make-staff-step">
          <Text tone="secondary">{sh.makeStaffIntro}</Text>
          <Chips
            label={sh.departmentLabel}
            options={[{ value: LATER, label: sh.departmentLater }, ...departmentOptions]}
            value={department}
            onChange={setDepartment}
            disabled={busy}
          />
          <FormError message={error} />
          <Button label={sh.makeStaffConfirm} loading={busy} onPress={confirmMakeStaff} testID="make-staff-confirm" />
          <Button label={sh.notNow} variant="ghost" disabled={busy} onPress={onClose} testID="make-staff-later" />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet visible title={sh.decideTitle(row.name)} onClose={onClose}>
      <View style={{ gap: 12, paddingBottom: 8 }} testID="decide-step">
        <Text tone="secondary">{sh.decideIntro}</Text>
        <Chips
          label={sh.acceptedLabel}
          options={[
            { value: "yes", label: sh.yes },
            { value: "no", label: sh.no },
          ]}
          value={accepted === null ? null : accepted ? "yes" : "no"}
          onChange={(v) => {
            setAccepted(v === "yes");
            setError(null);
          }}
          disabled={busy}
        />
        <TextField
          label={noteRequired ? sh.noteLabelRequired : sh.noteLabelOptional}
          value={note}
          onChangeText={(t) => {
            setNote(t);
            if (error === sh.noteRequired && t.trim()) setError(null);
          }}
          placeholder={noteRequired ? sh.notePlaceholderRequired : sh.notePlaceholderOptional}
          multiline
          editable={!busy}
          testID="decision-note"
        />
        <FormError message={error} />
        <Button label={sh.save} loading={busy} onPress={() => void save()} testID="decision-save" />
      </View>
    </Sheet>
  );
}
