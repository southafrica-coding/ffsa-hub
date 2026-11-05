import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { Banner, Button, Masthead, Text, TextField } from "@/components";
import { openWebPage } from "@/features/shell/web";
import { EmptyState, SkeletonRows } from "@/features/tickets/components/StateViews";
import { TicketsScreen } from "@/features/tickets/components/TicketsScreen";
import { DoorScreen } from "@/features/tickets/screens/DoorScreen";
import { hairline } from "@/theme/tokens";
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

  // Opened straight from a link there is nothing to go back to: offer Done,
  // which lands on Home (or sign-in, for someone without an account).
  const header = (
    <Stack.Screen
      options={{
        title: strings.title,
        headerLeft: router.canGoBack()
          ? undefined
          : () => (
              <Button
                label={strings.done}
                variant="ghost"
                accessibilityHint={strings.doneHint}
                onPress={() => router.replace("/")}
              />
            ),
      }}
    />
  );

  const openWeb = token ? () => void openWebPage(webScanPath(token), colors) : undefined;
  const webButton = openWeb ? (
    <Button label={strings.openWeb} variant="ghost" accessibilityHint={strings.openWebHint} onPress={openWeb} />
  ) : null;

  if (link.status === "loading" || (link.status === "ready" && name === undefined)) {
    return (
      <TicketsScreen>
        {header}
        <Masthead context={strings.context} title={strings.title} />
        <SkeletonRows rows={2} label={strings.loading} />
      </TicketsScreen>
    );
  }

  if (link.status === "dead") {
    return (
      <TicketsScreen>
        {header}
        <Masthead context={strings.context} title={strings.title} />
        <EmptyState title={strings.deadTitle} body={link.reason === "bad_link" ? strings.badLinkBody : strings.deadBody}>
          {link.reason === "gone" ? (
            <View style={{ gap: 8, paddingTop: 8 }}>
              <Button label={strings.retry} variant="secondary" onPress={() => void link.retry()} />
              {webButton}
            </View>
          ) : null}
        </EmptyState>
      </TicketsScreen>
    );
  }

  if (link.status === "error") {
    return (
      <TicketsScreen onRefresh={() => void link.retry()}>
        {header}
        <Masthead context={strings.context} title={strings.title} />
        <Banner
          tone="danger"
          title={strings.errorTitle}
          testID="error-state"
          action={<Button label={strings.retry} variant="secondary" onPress={() => void link.retry()} />}
        >
          {link.message}
        </Banner>
        {webButton}
      </TicketsScreen>
    );
  }

  const eventTitle = link.event?.title ?? strings.context;

  if (!name || !door) {
    return (
      <TicketsScreen>
        {header}
        <Masthead context={eventTitle} title={strings.title} />
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
    <>
      {header}
      <DoorScreen
        eventId={key}
        eventTitle={eventTitle}
        door={door}
        queueOwner={queueOwner}
        intro={
          <View
            testID="scanning-as"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingVertical: 4,
              borderBottomWidth: hairline,
              borderBottomColor: colors.rule,
            }}
          >
            <Text tone="secondary" style={{ flexShrink: 1 }}>
              {strings.scanningAs(name)}
            </Text>
            <Button
              label={strings.notYou}
              variant="ghost"
              accessibilityHint={strings.notYouHint}
              onPress={() => {
                setName(null);
                void clearScannerName();
              }}
            />
          </View>
        }
      />
    </>
  );
}

function NameForm({ onSave }: { onSave: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  const value = cleanScannerName(draft);
  const submit = () => {
    if (value) onSave(value);
  };
  return (
    <View style={{ gap: 12 }}>
      <Text variant="title">{strings.nameTitle}</Text>
      <Text tone="secondary">{strings.nameBody}</Text>
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
