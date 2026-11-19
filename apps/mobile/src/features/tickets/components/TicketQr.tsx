import { View, useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { Text } from "@/components";
import { fontFamily, hairline, palette, radius } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

/**
 * The ticket's QR, drawn on the phone from the code (no network needed, so
 * it works at a door with no signal). Always ink on white, in dark mode too:
 * scanners need dark modules on a light field with a quiet zone. The code is
 * printed under it in mono, exactly as issued (it is case-sensitive), for
 * typing in by hand.
 */
export function TicketQr({ code, dimmed = false }: { code: string; dimmed?: boolean }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(Math.max(width - 136, 180), 260);
  return (
    <View style={{ borderWidth: hairline, borderColor: colors.rule, borderRadius: radius.card, backgroundColor: colors.raised, overflow: "hidden" }}>
      <View
        testID="ticket-qr"
        accessible
        accessibilityRole="image"
        accessibilityLabel={dimmed ? `${strings.a11y.qrCancelled}. ${strings.ticket.qrLabel(code)}` : strings.ticket.qrLabel(code)}
        accessibilityIgnoresInvertColors
        style={{ alignItems: "center", padding: 16, backgroundColor: palette.white, borderBottomWidth: hairline, borderBottomColor: colors.ruleStrong }}
      >
        <View style={{ opacity: dimmed ? 0.18 : 1 }}>
          <QRCode value={code} size={size} color={palette.ink} backgroundColor={palette.white} ecl="M" quietZone={8} />
        </View>
      </View>
      {/* Spelled out in the QR's label above, so not read twice. */}
      <View style={{ alignItems: "center", paddingVertical: 10, paddingHorizontal: 12 }} accessible={false} importantForAccessibility="no-hide-descendants">
        <Text
          selectable
          maxFontSizeMultiplier={1.6}
          style={{ fontFamily: fontFamily.monoBold, fontSize: 20, lineHeight: 28, letterSpacing: 0.8, textAlign: "center" }}
          testID="ticket-code"
        >
          {code}
        </Text>
      </View>
    </View>
  );
}
