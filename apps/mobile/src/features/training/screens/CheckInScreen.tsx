import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { Bleed, Button, ChoiceChips, FieldError, LargeTitleScrollView, Text, TextField, KeyboardAvoidingView } from "@/components";
import { apiFetch } from "@/lib/api-client";
import { hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { CONTACTS, MOODS, loadErrorMessage, saveCheckin, type Contact, type Mood } from "../api";
import { strings } from "../strings";

const c = strings.checkin;

// The weekly check-in (48d): about 30 seconds. Two notes that look nothing
// alike: one the student reads (yellow rule), one only staff see (ink
// panel). "Needs care" tells the school leader and everyone walking with
// them, without the notes. Saving again in the same week updates the same
// check-in (server side).
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }}>
      <LargeTitleScrollView
        back={{ label: name || strings.back, onPress: () => router.back() }}
        eyebrow={c.context}
        tick={false}
        title={c.title(name.split(" ")[0] || name)}
        edges={["top", "bottom"]}
      >
        <ChoiceChips<Contact>
          label={c.contactLabel}
          options={CONTACTS.map((v) => ({ value: v, label: strings.contact[v] }))}
          value={contact}
          onChange={setContact}
        />
        {reached ? (
          <ChoiceChips<Mood> label={c.moodLabel} options={MOODS.map((v) => ({ value: v, label: strings.mood[v] }))} value={mood} onChange={setMood} />
        ) : null}
        {/* The note they read: a yellow rule. */}
        <View style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: space.md }}>
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
        {/* The note only staff see: a different shape entirely (bordered panel, ink edge). */}
        <Bleed>
          <View
            style={{
              borderLeftWidth: 6,
              borderLeftColor: colors.inverse,
              borderWidth: hairline,
              borderColor: colors.rule,
              borderRadius: radius.card,
              backgroundColor: colors.surface,
              padding: space.md,
            }}
          >
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
        </Bleed>
        <Bleed>
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
              alignItems: "flex-start",
              gap: space.md,
              padding: space.md,
              borderWidth: hairline,
              borderColor: colors.ruleStrong,
              borderRadius: radius.card,
              backgroundColor: pressed ? colors.surfaceStrong : colors.raised,
            })}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 22,
                height: 22,
                marginTop: 1,
                borderRadius: radius.control,
                borderWidth: 1.5,
                borderColor: needsCare ? colors.primary : colors.ruleStrong,
                backgroundColor: needsCare ? colors.primary : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {needsCare ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="rowTitle">{c.needsCare}</Text>
              <Text variant="caption" tone="secondary">
                {c.needsCareHint}
              </Text>
            </View>
          </Pressable>
        </Bleed>
        {error ? (
          <View testID="training-checkin-error" accessibilityLiveRegion="polite">
            <FieldError>{error}</FieldError>
          </View>
        ) : null}
        <Button label={saving ? c.saving : c.save} loading={saving} disabled={saving} onPress={save} testID="training-checkin-save" />
        <Text variant="caption" tone="secondary">
          {c.savedNote}
        </Text>
      </LargeTitleScrollView>
    </KeyboardAvoidingView>
  );
}
