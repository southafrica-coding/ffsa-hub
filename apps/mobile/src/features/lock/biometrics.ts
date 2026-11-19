// The only file that talks to expo-local-authentication.

import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

import { availability, biometricKind, unlockOutcome, type Availability, type UnlockOutcome } from "./logic";

/** Can this phone lock the app (hardware AND something enrolled), and what is it called? */
export async function checkBiometrics(): Promise<Availability> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return availability(hasHardware, enrolled, biometricKind(types, Platform.OS));
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Ask for Face ID / Touch ID / fingerprint. The phone's own passcode is the
 * fallback (disableDeviceFallback: false): the app never has a PIN of its own.
 */
export async function authenticate(promptMessage: string, cancelLabel: string): Promise<UnlockOutcome> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false,
    });
    return unlockOutcome(result);
  } catch {
    return "failed";
  }
}
