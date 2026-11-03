import { useState } from "react";
import { View } from "react-native";

import { Button, Text, TextField } from "@/components";
import { Sheet } from "@/features/finance/components/Sheet";

import { strings } from "../strings";

import { CheckRow, FormError } from "./ui";

const d = strings.decision;

/**
 * Approve or decline, from a bottom sheet. The note is optional (it is on
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
      <View style={{ gap: 12, paddingBottom: 8 }}>
        {hint ? <Text tone="secondary">{hint}</Text> : null}
        <TextField
          label={d.noteLabel}
          hint={d.noteHint}
          value={note}
          onChangeText={setNote}
          placeholder={d.notePlaceholder}
          multiline
          testID="decision-note"
        />
        {seriesOption ? <CheckRow label={d.series} checked={series} onChange={setSeries} testID="decision-series" /> : null}
        <FormError message={error} />
        <Button
          label={approving ? d.confirmApprove : d.confirmDecline}
          variant={approving ? "primary" : "destructive"}
          loading={busy}
          onPress={() => void confirm()}
          testID="decision-confirm"
        />
      </View>
    </Sheet>
  );
}
