import { Stack } from "expo-router";

import { CvScreen } from "@/features/me/screens/CvScreen";
import { meStrings } from "@/features/me/strings";

// The header comes from the Me stack; only the title is set here so
// app/(app)/me/_layout.tsx stays as is.
export default function Route() {
  return (
    <>
      <Stack.Screen options={{ title: meStrings.docs.cv.title }} />
      <CvScreen />
    </>
  );
}
