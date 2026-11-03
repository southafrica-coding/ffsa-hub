import { View, useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { Text } from "@/components";
import { fontFamily, palette } from "@/theme/tokens";

import { strings } from "../strings";

/**
 * The ticket's QR, drawn on the phone from the code (no network needed, so
 * it works at a door with no signal). Always ink on white, in dark mode too:
 * scanners need dark modules on a light field with a quiet zone. The code is
 * printed under it in mono for typing in by hand.
 */
export function TicketQr({ code, dimmed = false }: { code: string; dimmed?: boolean }) {
  const { width } = useWindowDimensions();
  const size = Math.min(Math.max(width - 88, 180), 320);
  return (
    <View style={{ alignItems: "center", gap: 12 }}>
      <View
        testID="ticket-qr"
        accessible
        accessibilityRole="image"
        accessibilityLabel={strings.ticket.qrLabel(code)}
        style={{ padding: 16, backgroundColor: palette.white, borderWidth: 2, borderColor: palette.ink, opacity: dimmed ? 0.25 : 1 }}
      >
        <QRCode value={code} size={size} color={palette.ink} backgroundColor={palette.white} ecl="M" quietZone={8} />
      </View>
      <View style={{ alignItems: "center", gap: 2 }} accessible={false} importantForAccessibility="no-hide-descendants">
        <Text variant="label" tone="secondary">
          {strings.ticket.codeLabel}
        </Text>
        <Text
          selectable
          style={{ fontFamily: fontFamily.monoBold, fontSize: 22, letterSpacing: 2.5 }}
          testID="ticket-code"
        >
          {code}
        </Text>
      </View>
    </View>
  );
}
