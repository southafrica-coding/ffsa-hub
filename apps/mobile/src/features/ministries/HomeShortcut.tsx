import { useRouter } from "expo-router";
import { UsersRound } from "lucide-react-native";

import { ListRow } from "@/features/shell";

import { useMinistriesShortcut } from "./shortcut";
import { strings } from "./strings";

/**
 * Home's "Ministries" row, shown only to people who can open the web
 * Ministry tab (see shortcut.ts). Self-contained so Home needs one line.
 */
export function MinistriesHomeShortcut() {
  const router = useRouter();
  const show = useMinistriesShortcut();
  if (!show) return null;
  return (
    <ListRow
      icon={UsersRound}
      title={strings.shortcut.title}
      subtitle={strings.shortcut.subtitle}
      onPress={() => router.navigate("/ministries")}
      testID="shortcut-ministries"
    />
  );
}
