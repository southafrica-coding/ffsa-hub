import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Text } from "@/components";
import { hairline, palette } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

import { useReduceMotion } from "./ui";

/**
 * A bottom sheet for short choices (budget line, etc.). Slides up from the
 * bottom edge, closes on the backdrop, the Close button or the system back
 * gesture, and traps screen-reader focus while open.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          // The scrim is ink in both colour schemes.
          accessibilityRole="button"
          accessibilityLabel={strings.common.close}
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.ink, opacity: 0.45 }}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "80%",
            backgroundColor: colors.bg,
            borderTopWidth: 2,
            borderTopColor: colors.text,
            paddingBottom: insets.bottom + 8,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingLeft: 20,
              paddingRight: 8,
              paddingVertical: 4,
              borderBottomWidth: hairline,
              borderBottomColor: colors.rule,
            }}
          >
            <Text variant="title" style={{ flexShrink: 1 }}>
              {title}
            </Text>
            <Button label={strings.common.close} variant="ghost" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
