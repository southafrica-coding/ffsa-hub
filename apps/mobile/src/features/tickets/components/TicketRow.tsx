import { Check, ChevronRight, Ticket as TicketIcon, X } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { MyRegistration, MyTicket } from "../api";
import { dateBlock, formatEventWhen } from "../dates";
import { strings } from "../strings";

function DateBlock({ day }: { day: string }) {
  const { colors } = useTheme();
  const b = dateBlock(day);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: 48, alignItems: "center", borderWidth: hairline, borderColor: colors.text, paddingVertical: 4 }}
    >
      <Text variant="title" style={{ fontVariant: ["tabular-nums"] }}>
        {b.day}
      </Text>
      <Text variant="label" tone="secondary">
        {b.mon}
      </Text>
    </View>
  );
}

/** Status as icon + words: never colour alone. */
export function StatusTag({ status }: { status: string }) {
  const { colors } = useTheme();
  const label = strings.status[status] ?? strings.status.unknown;
  const Icon = status === "checked_in" ? Check : status === "void" || status === "cancelled" ? X : TicketIcon;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon size={14} color={colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="label" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

type RowProps = {
  title: string;
  when: string;
  where: string;
  holder?: string;
  status: string;
  day: string;
  onPress?: () => void;
  testID?: string;
};

function Row({ title, when, where, holder, status, day, onPress, testID }: RowProps) {
  const { colors } = useTheme();
  const statusLabel = strings.status[status] ?? strings.status.unknown;
  const a11y = [title, when, where, holder ? `${strings.myTickets.holder}: ${holder}` : null, statusLabel]
    .filter(Boolean)
    .join(". ");
  const body = (
    <>
      <DateBlock day={day} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" tone="secondary">
          {when}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {where}
        </Text>
        {holder ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {holder}
          </Text>
        ) : null}
        <StatusTag status={status} />
      </View>
      {onPress ? <ChevronRight size={20} color={colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no" /> : null}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    minHeight: touch.minTarget,
    paddingVertical: 14,
    borderBottomWidth: hairline,
    borderBottomColor: colors.rule,
  };
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={a11y} style={style}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={strings.myTickets.openTicketHint}
      onPress={onPress}
      style={({ pressed }) => [style, pressed ? { backgroundColor: colors.surface } : null]}
    >
      {body}
    </Pressable>
  );
}

export function TicketRow({ ticket, onPress }: { ticket: MyTicket; onPress: () => void }) {
  return (
    <Row
      testID={`ticket-${ticket.id}`}
      title={ticket.event.title}
      when={formatEventWhen(ticket.event)}
      where={ticket.event.location ?? strings.ticket.locationTbc}
      holder={ticket.holderName ? `${ticket.holderName} · ${ticket.ticketTypeName}` : ticket.ticketTypeName}
      status={ticket.status}
      day={ticket.event.startDate}
      onPress={onPress}
    />
  );
}

export function RegistrationRow({ registration }: { registration: MyRegistration }) {
  return (
    <Row
      testID={`registration-${registration.id}`}
      title={registration.event.title}
      when={formatEventWhen(registration.event)}
      where={registration.event.location ?? strings.ticket.locationTbc}
      holder={strings.myTickets.registrationOnly}
      status={registration.status}
      day={registration.event.startDate}
    />
  );
}
