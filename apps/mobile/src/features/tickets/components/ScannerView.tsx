import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Flashlight, FlashlightOff, X } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Text } from "@/components";
import { palette, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

type Props = {
  /** Raw QR contents. Debouncing happens in the door controller. */
  onScanned: (data: string) => void;
  /** Stop reading codes (a result is on screen, or one is being sent). */
  paused: boolean;
  onClose: () => void;
  /** "Type the code instead" from the permission screens. */
  onTypeCode: () => void;
  /** Shown over the bottom of the viewfinder (the verdict). */
  overlay?: ReactNode;
};

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: touch.minTarget + 8,
        height: touch.minTarget + 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? palette.textSecondary : palette.ink,
        borderWidth: 2,
        borderColor: palette.white,
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pressable>
  );
}

/**
 * Full-screen QR scanner. Asks for the camera just in time, explains why
 * first, and if it has been refused offers Settings plus the ways to check
 * someone in without a camera. QR codes only.
 *
 * The camera chrome is ink/white regardless of theme: it sits over a live
 * picture, so it needs the strongest contrast available.
 */
export function ScannerView({ onScanned, paused, onClose, onTypeCode, overlay }: Props) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [mountError, setMountError] = useState(false);

  const handle = (r: BarcodeScanningResult) => {
    if (r.data) onScanned(r.data);
  };

  if (!permission) {
    return (
      <View
        testID="scanner-loading"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={strings.a11y.scannerStarting}
        style={{ flex: 1, backgroundColor: colors.bg }}
      />
    );
  }

  if (!permission.granted) {
    const denied = !permission.canAskAgain;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={denied ? "camera-denied" : "camera-rationale"}>
        <View style={{ flex: 1, padding: 20, gap: 16, justifyContent: "center" }}>
          <Text variant="title">{denied ? strings.camera.deniedTitle : strings.camera.rationaleTitle}</Text>
          <Text tone="secondary">{denied ? strings.camera.deniedBody : strings.camera.rationaleBody}</Text>
          {denied ? (
            <Button label={strings.camera.openSettings} onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label={strings.camera.allow} onPress={() => void requestPermission()} />
          )}
          <Button label={strings.checkIn.typeCode} variant="secondary" onPress={onTypeCode} />
          <Button label={strings.camera.close} variant="ghost" onPress={onClose} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.ink }} testID="scanner">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={paused ? undefined : handle}
        onMountError={() => setMountError(true)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={strings.a11y.camera}
        accessibilityIgnoresInvertColors
      />
      <SafeAreaView style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
        <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 16 }} pointerEvents="box-none">
          <IconButton label={strings.camera.close} onPress={onClose}>
            <X size={28} color={palette.white} strokeWidth={3} />
          </IconButton>
          <IconButton label={torch ? strings.camera.torchOff : strings.camera.torchOn} onPress={() => setTorch((t) => !t)}>
            {torch ? <FlashlightOff size={26} color={palette.white} /> : <Flashlight size={26} color={palette.white} />}
          </IconButton>
        </View>
        <View style={{ flex: 1 }} pointerEvents="none" />
        <View style={{ padding: 16, gap: 12 }} pointerEvents="box-none">
          {overlay ?? (
            <View
              accessibilityLiveRegion={mountError ? "assertive" : "none"}
              accessibilityRole={mountError ? "alert" : undefined}
              style={{ backgroundColor: palette.ink, padding: 14, borderWidth: 2, borderColor: palette.white }}
            >
              <Text tone="onInverse" style={{ color: palette.white }}>
                {mountError ? strings.camera.mountError : strings.camera.aim}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
