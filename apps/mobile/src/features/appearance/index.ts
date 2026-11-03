export { SunMoon as AppearanceIcon } from "lucide-react-native";

export { AppearanceProvider, useAppearance, type AppearanceState } from "./AppearanceProvider";
export { AppearanceScreen } from "./AppearanceScreen";
export {
  APPEARANCE_PREFERENCES,
  applyPreference,
  readPreference,
  resolveScheme,
  writePreference,
  type AppearancePreference,
} from "./preference";
export { appearanceStrings } from "./strings";
