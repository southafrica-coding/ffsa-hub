import { Stack } from "expo-router";

import { DeleteAccountScreen } from "@/features/account-deletion/DeleteAccountScreen";
import { strings } from "@/features/account-deletion/strings";

// Me → Request account deletion (Apple 5.1.1(v), Google Play). Pushed on the
// Me stack; the title is set here so the Me layout stays untouched.
export default function DeleteAccountRoute() {
  return (
    <>
      <Stack.Screen options={{ title: strings.title }} />
      <DeleteAccountScreen />
    </>
  );
}
