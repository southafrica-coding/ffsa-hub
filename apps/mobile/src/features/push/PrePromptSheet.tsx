import { View } from "react-native";

import { Button, Sheet, Text } from "@/components";
import { BulletList } from "@/features/me/components/me-kit";

import { pushStrings } from "./strings";

const s = pushStrings.prePrompt;

/**
 * Our own explanation before the phone's permission prompt (which can only
 * be shown once). "Not now" leaves everything off and we don't ask again for
 * a month. The kit's bottom sheet: backdrop / back gesture close it,
 * screen-reader focus stays inside, reduce motion respected.
 */
export function PrePromptSheet({
  visible,
  onAccept,
  onDecline,
}: {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Sheet visible={visible} title={s.title} onClose={onDecline}>
      <View style={{ gap: 12 }} testID="push-pre-prompt">
        <Text>{s.lead}</Text>
        <BulletList items={s.examples} />
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="secondary">
            {s.privacy}
          </Text>
          <Text variant="caption" tone="secondary">
            {s.later}
          </Text>
        </View>
        <View style={{ gap: 8, paddingTop: 4 }}>
          <Button label={s.accept} onPress={onAccept} accessibilityHint={s.acceptHint} />
          <Button label={s.decline} variant="secondary" onPress={onDecline} />
        </View>
      </View>
    </Sheet>
  );
}
