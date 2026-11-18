import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Masthead, Screen, Text, TextField } from "@/components";
import { Chips } from "@/features/finance/components/ui";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { CONTACTS, MOODS, loadErrorMessage, saveCheckin, type Contact, type Mood } from "../api";
import { strings } from "../strings";

const c = strings.checkin;

// The weekly check-in (48d): about 30 seconds. Two notes that look nothing
// alike: one the student reads, one only staff see. "Needs care" tells the
// school leader and everyone walking with them, without the notes.
// Saving again in the same week updates the same check-in (server side).
export default function CheckInScreen({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [contact, setContact] = useState<Contact>("met");
  const [mood, setMood] = useState<Mood | null>(null);
  const [forThem, setForThem] = useState("");
  const [staffOnly, setStaffOnly] = useState("");
  const [needsCare, setNeedsCare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reached = contact !== "no_reach";

  async function save() {
    if (reached && !mood) {
      setError(c.moodMissing);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveCheckin(apiFetch, { enrollmentId: id, contact, mood, noteForStudent: forThem, noteStaffOnly: staffOnly, needsCare });
      router.back();
    } catch (err) {
      setError(loadErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Screen keyboard edges={["bottom"]}>
      <Masthead context={c.context.toUpperCase()} title={c.title(name.split(" ")[0] || name)} />
      <Chips<Contact>
        label={c.contactLabel}
        options={CONTACTS.map((v) => ({ value: v, label: strings.contact[v] }))}
        value={contact}
        onChange={setContact}
      />
      {reached ? (
        <Chips<Mood> label={c.moodLabel} options={MOODS.map((v) => ({ value: v, label: strings.mood[v] }))} value={mood} onChange={setMood} />
      ) : null}
      <View style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 10 }}>
        <TextField
          testID="training-note-for-them"
          label={c.forThemLabel}
          hint={c.forThemHint}
          value={forThem}
          onChangeText={setForThem}
          multiline
          maxLength={2000}
        />
      </View>
      <View style={{ borderLeftWidth: 6, borderLeftColor: colors.inverse, backgroundColor: colors.surface, padding: 10 }}>
        <TextField
          testID="training-note-staff"
          label={c.staffLabel}
          hint={c.staffHint}
          value={staffOnly}
          onChangeText={setStaffOnly}
          multiline
          maxLength={2000}
        />
      </View>
      <Pressable
        testID="training-needs-care"
        accessibilityRole="checkbox"
        accessibilityLabel={c.needsCare}
        accessibilityHint={c.needsCareHint}
        accessibilityState={{ checked: needsCare }}
        onPress={() => setNeedsCare((v) => !v)}
        style={({ pressed }) => ({
          minHeight: touch.minTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          borderWidth: 1.5,
          borderColor: colors.text,
          backgroundColor: pressed ? colors.surface : "transparent",
        })}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 22,
            height: 22,
            borderWidth: 2,
            borderColor: colors.text,
            backgroundColor: needsCare ? colors.inverse : "transparent",
          }}
        />
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <Text variant="bodyStrong">{c.needsCare}</Text>
          <Text variant="caption" tone="secondary">
            {c.needsCareHint}
          </Text>
        </View>
      </Pressable>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite" testID="training-checkin-error">
          {error}
        </Text>
      ) : null}
      <Button label={saving ? c.saving : c.save} loading={saving} disabled={saving} onPress={save} testID="training-checkin-save" />
      <Text variant="caption" tone="secondary" style={{ borderTopWidth: hairline, borderTopColor: colors.rule, paddingTop: 8 }}>
        {c.savedNote}
      </Text>
    </Screen>
  );
}
