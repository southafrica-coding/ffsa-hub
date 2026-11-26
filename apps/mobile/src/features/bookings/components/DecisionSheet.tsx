import { useState } from "react";
import { View } from "react-native";

import { Button, Sheet, Text, TextField } from "@/components";

import { strings } from "../strings";

import { CheckRow, FormError } from "./ui";

const d = strings.decision;

/**
 * Approve or decline, from a bottom sheet (frame 7.10): Cancel beside the
 * decision, which is a filled red button when declining. The note is optional (it is on
 * the web too) and goes to the requester with the decision. The sheet stays
 * open on failure so the server's reason is read where the person acted.
 * Give it key={decision} so each opening starts clean.
 */
export function DecisionSheet({
  decision,
  onClose,
  onConfirm,
  seriesOption = false,
  hint,
}: {
  decision: "approved" | "denied" | null;
  onClose: () => void;
  onConfirm: (note: string, applyToSeries: boolean) => Promise<string | null>;
  seriesOption?: boolean;
  hint?: string;
}) {
  const [note, setNote] = useState("");
  const [series, setSeries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approving = decision === "approved";

  async function confirm() {
    setBusy(true);
    setError(null);
    const failure = await onConfirm(note, series);
    setBusy(false);
    if (failure) setError(failure);
    else {
      setNote("");
      setSeries(false);
    }
  }

  return (
    <Sheet visible={decision !== null} title={approving ? d.approveTitle : d.declineTitle} onClose={onClose}>
      {hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
      <TextField label={d.noteLabel} hint={d.noteHint} value={note} onChangeText={setNote} placeholder={d.notePlaceholder} multiline testID="decision-note" />
      {seriesOption ? <CheckRow label={d.series} checked={series} onChange={setSeries} testID="decision-series" /> : null}
      <FormError message={error} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label={strings.common.cancel} variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} testID="decision-cancel" />
        <Button
          label={approving ? d.confirmApprove : d.confirmDecline}
          variant={approving ? "primary" : "dangerFill"}
          loading={busy}
          onPress={() => void confirm()}
          style={{ flex: 1 }}
          testID="decision-confirm"
        />
      </View>
    </Sheet>
  );
}
