import { useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { Banner, Button, EmptyState, SkeletonList, Text, TextField, WebHint } from "@/components";
import { openWebPage } from "@/features/shell/web";
import { Heading } from "@/features/tickets/components/ListHeader";
import { TicketsScreen } from "@/features/tickets/components/TicketsScreen";
import { DoorScreen } from "@/features/tickets/screens/DoorScreen";
import { hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { doorKey, parseScanToken, volunteerDoorClient, webScanPath, type PublicFetch } from "../api";
import { publicFetch as livePublicFetch } from "../client";
import { cleanScannerName, clearScannerName, loadScannerName, MAX_NAME, saveScannerName } from "../scanner-name";
import { strings } from "../strings";
import { useScanLink } from "../use-scan-link";

type Props = {
  /** The raw [token] route param. */
  token: unknown;
  /** Injected in tests; the live session-free fetch by default. */
  fetcher?: PublicFetch;
};

/**
 * The volunteer door: a scan link opened in the app, signed in or not. The
 * link is the authority, so this never uses the person's own Hub session
 * (a signed-in staff member gets exactly what a volunteer gets). Once the
 * link checks out and a first name is known, it is the Tickets door:
 * same tally, scanner, verdicts, Undo, name search and offline queue.
 */
export function PublicScanScreen({ token: raw, fetcher = livePublicFetch }: Props) {
  const token = parseScanToken(raw);
  const link = useScanLink(token, fetcher);
  const { colors } = useTheme();
  const router = useRouter();

  // undefined while the saved name is being read; null when there is none.
  const [name, setName] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadScannerName().then((saved) => {
      if (!cancelled) setName(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const key = token ? doorKey(token) : "";
  const queueOwner = useCallback(async () => key || null, [key]);
  const door = useMemo(
    () => (token && name ? volunteerDoorClient(fetcher, token, { scannerName: name }) : null),
    [fetcher, token, name],
  );

  // The door stands outside the tabs: Done leaves it. Opened straight from a
  // link there is nothing to go back to, so it lands on Home (or sign-in, for
  // someone without an account).
  const done = (
    <Button
      label={strings.done}
      variant="ghost"
      size="small"
      accessibilityHint={strings.doneHint}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    />
  );
  const page = { title: strings.title, navLeft: done, bottomInset: true };

  const openWeb = token ? () => void openWebPage(webScanPath(token), colors) : undefined;
  const webButton = openWeb ? (
    <View style={{ alignItems: "center", gap: space.xs }}>
      <Button label={strings.openWeb} variant="text" accessibilityHint={strings.openWebHint} onPress={openWeb} />
      <WebHint />
    </View>
  ) : null;

  if (link.status === "loading" || (link.status === "ready" && name === undefined)) {
    return (
      <TicketsScreen {...page} eyebrow={strings.context}>
        <SkeletonList inset={false} count={2} label={strings.loading} />
      </TicketsScreen>
    );
  }

  if (link.status === "dead") {
    const gone = link.reason === "gone";
    return (
      <TicketsScreen {...page} eyebrow={strings.context}>
        <EmptyState
          icon={Lock}
          title={strings.deadTitle}
          body={gone ? strings.deadBody : strings.badLinkBody}
          actionLabel={gone ? strings.retry : undefined}
          onAction={gone ? () => void link.retry() : undefined}
          testID="empty-state"
        />
        {gone ? webButton : null}
      </TicketsScreen>
    );
  }

  if (link.status === "error") {
    return (
      <TicketsScreen {...page} eyebrow={strings.context} onRefresh={() => void link.retry()}>
        <Banner tone="error" title={strings.errorTitle} testID="error-state" actionLabel={strings.retry} onAction={() => void link.retry()}>
          {link.message}
        </Banner>
        {webButton}
      </TicketsScreen>
    );
  }

  const eventTitle = link.event?.title ?? strings.context;

  if (!name || !door) {
    return (
      <TicketsScreen {...page} eyebrow={eventTitle} keyboard>
        <NameForm
          onSave={(value) => {
            setName(value);
            void saveScannerName(value);
          }}
        />
      </TicketsScreen>
    );
  }

  return (
    <DoorScreen
      eventId={key}
      eventTitle={eventTitle}
      title={strings.title}
      navLeft={done}
      door={door}
      queueOwner={queueOwner}
      intro={
        <View
          testID="scanning-as"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.md,
            paddingBottom: space.xs,
            borderBottomWidth: hairline,
            borderBottomColor: colors.rule,
          }}
        >
          <Text tone="secondary" style={{ flexShrink: 1 }}>
            {strings.scanningAs(name)}
          </Text>
          <Button
            label={strings.notYou}
            variant="text"
            size="small"
            accessibilityHint={strings.notYouHint}
            onPress={() => {
              setName(null);
              void clearScannerName();
            }}
          />
        </View>
      }
    />
  );
}

function NameForm({ onSave }: { onSave: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  const value = cleanScannerName(draft);
  const submit = () => {
    if (value) onSave(value);
  };
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Heading>{strings.nameTitle}</Heading>
        <Text tone="secondary">{strings.nameBody}</Text>
      </View>
      <TextField
        label={strings.nameField}
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="given-name"
        textContentType="givenName"
        maxLength={MAX_NAME}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button label={strings.nameStart} accessibilityHint={strings.nameStartHint} disabled={!value} onPress={submit} />
    </View>
  );
}
