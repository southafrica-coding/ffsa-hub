import { BellRing } from "lucide-react-native";
import { View } from "react-native";

import { Button, Text } from "@/components";
import { Sheet } from "@/features/finance/components/Sheet";
import { useTheme } from "@/theme/use-theme";

import { pushStrings } from "./strings";

const s = pushStrings.prePrompt;

/**
 * Our own explanation before the phone's permission prompt (which can only
 * be shown once). "Not now" leaves everything off and we don't ask again for
 * a month. Reuses Finance's bottom sheet (backdrop / back gesture close it,
 * screen-reader focus stays inside, reduce motion respected).
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
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} title={s.title} onClose={onDecline}>
      <View style={{ gap: 12, paddingVertical: 8 }} testID="push-pre-prompt">
        <BellRing size={28} color={colors.text} accessibilityElementsHidden importantForAccessibility="no" />
        <Text>{s.lead}</Text>
        <View style={{ gap: 6 }}>
          {s.examples.map((line) => (
            <Text key={line} accessibilityLabel={line}>
              {`•  ${line}`}
            </Text>
          ))}
        </View>
        <Text tone="secondary">{s.privacy}</Text>
        <Text variant="caption" tone="secondary">
          {s.later}
        </Text>
        <View style={{ gap: 8, paddingTop: 4 }}>
          <Button label={s.accept} onPress={onAccept} accessibilityHint={s.acceptHint} />
          <Button label={s.decline} variant="secondary" onPress={onDecline} />
        </View>
      </View>
    </Sheet>
  );
}
