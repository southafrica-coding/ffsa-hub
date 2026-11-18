import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Text } from "@/components";
import { getEnv } from "@/lib/env";
import { useTheme } from "@/theme/use-theme";

import { ZoomableImage } from "../components/ZoomableImage";
import { strings } from "../strings";
import { isAllowedReceiptUri } from "../viewer-uri";

/** Full-screen receipt (a signed URL from the API, or a photo still on this phone). */
export default function ReceiptViewerScreen({ uri: rawUri, title }: { uri?: string; title?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const uri = isAllowedReceiptUri(rawUri, { supabaseUrl: getEnv().supabaseUrl, documentDir: Paths.document.uri }) ? rawUri : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 8, gap: 8 }}>
        <Text variant="monoLabel" tone="secondary" numberOfLines={2} style={{ flex: 1 }} accessibilityRole="header">
          {title || strings.viewer.title}
        </Text>
        <Button label={strings.common.close} variant="ghost" onPress={() => router.back()} />
      </View>
      {uri ? (
        <ZoomableImage uri={uri} label={title ? `${strings.viewer.title}: ${title}` : strings.viewer.title} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text accessibilityRole="alert">{strings.viewer.loadFailed}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
