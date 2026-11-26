// Per-weight imports: the packages' index files require every weight
// (~7 MB of TTFs). These nine are all the app uses.
import { Roboto_400Regular } from "@expo-google-fonts/roboto/400Regular";
import { Roboto_500Medium } from "@expo-google-fonts/roboto/500Medium";
import { Roboto_600SemiBold } from "@expo-google-fonts/roboto/600SemiBold";
import { Roboto_700Bold } from "@expo-google-fonts/roboto/700Bold";
import { Roboto_800ExtraBold } from "@expo-google-fonts/roboto/800ExtraBold";
import { Roboto_900Black } from "@expo-google-fonts/roboto/900Black";
import { RobotoCondensed_400Regular } from "@expo-google-fonts/roboto-condensed/400Regular";
import { RobotoMono_500Medium } from "@expo-google-fonts/roboto-mono/500Medium";
import { RobotoMono_700Bold } from "@expo-google-fonts/roboto-mono/700Bold";

import { fontFamily } from "./tokens";

// Passed to expo-font's useFonts() in app/_layout.tsx. Keys are the family
// names in tokens.fontFamily, so the two can't drift.
export const fontAssets = {
  [fontFamily.body]: Roboto_400Regular,
  [fontFamily.bodyMedium]: Roboto_500Medium,
  [fontFamily.bodySemibold]: Roboto_600SemiBold,
  [fontFamily.bodyBold]: Roboto_700Bold,
  [fontFamily.bodyExtraBold]: Roboto_800ExtraBold,
  [fontFamily.display]: Roboto_900Black,
  [fontFamily.condensed]: RobotoCondensed_400Regular,
  [fontFamily.mono]: RobotoMono_500Medium,
  [fontFamily.monoBold]: RobotoMono_700Bold,
};
