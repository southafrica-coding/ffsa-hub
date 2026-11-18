import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReduceMotion } from "@/lib/a11y";
import { fontFamily, fontSize, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { kitStrings } from "./strings";
import { Text } from "./Text";

export type SheetProps = {
  visible: boolean;
  title: string;
  /** One caption line under the title. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling body (decision buttons). */
  footer?: ReactNode;
  /** Close button's spoken label (default "Close"). */
  closeLabel?: string;
  testID?: string;
};

/**
 * The app's one bottom sheet (short choices, record detail, confirms): 8pt top
 * corners, grabber, 17/600 title and a × close button. Closes on the scrim,
 * the × or the system back gesture, and keeps screen-reader focus inside
 * while open. No slide under Reduce Motion.
 *
 * A custom Modal rather than expo-router's formSheet: every sheet in the app
 * is opened from component state (not a route), so moving to formSheet
 * would mean new routes and passing state through params (a behaviour change
 * for the feature slices, not this kit).
 */
export function Sheet({ visible, title, subtitle, onClose, children, footer, closeLabel = kitStrings.close, testID }: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "fade" : "slide"} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          // Hidden from screen readers: the × and the back gesture do the same job.
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim }}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={{
            maxHeight: "88%",
            backgroundColor: colors.raised,
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            borderTopWidth: hairline,
            borderColor: colors.rule,
            paddingBottom: insets.bottom + space.sm,
          }}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginTop: 6, backgroundColor: colors.ruleStrong, opacity: 0.6 }}
          />
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingLeft: space.gutter, paddingRight: space.sm, paddingTop: space.sm }}>
            <View style={{ flex: 1, paddingTop: 10, gap: 2 }}>
              <Text accessibilityRole="header" style={{ fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sheetTitle, lineHeight: 24 }}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="caption" tone="secondary">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              hitSlop={4}
              style={({ pressed }) => ({
                width: touch.floor,
                height: touch.floor,
                borderRadius: radius.control,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? colors.surface : "transparent",
              })}
            >
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <X size={22} color={colors.text} />
              </View>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: space.xs, paddingBottom: space.lg, gap: space.lg }}>
            {children}
          </ScrollView>
          {footer ? (
            <View style={{ paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.sm, borderTopWidth: hairline, borderTopColor: colors.rule }}>
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
