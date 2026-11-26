import { ChevronRight, Clock, Ticket as TicketIcon, type LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { StatusChip, Text } from "@/components";
import type { ChipVariant } from "@/theme/styles";
import { fontFamily, fontSize, hairline, letterSpacingEm, radius, space } from "@/theme/tokens";
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
      // minWidth, not width: a large day number grows the box instead of clipping.
      style={{ minWidth: 48, alignItems: "center", borderWidth: hairline, borderColor: colors.text, borderRadius: radius.control, paddingVertical: 4 }}
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, fontSize: 18, lineHeight: 22, fontVariant: ["tabular-nums"] }}>{b.day}</Text>
      <Text
        tone="secondary"
        style={{ fontFamily: fontFamily.bodyBold, fontSize: fontSize.monoLabel, lineHeight: 16, letterSpacing: fontSize.monoLabel * letterSpacingEm.eyebrow }}
      >
        {b.mon}
      </Text>
    </View>
  );
}

// Checked in and Cancelled take the kit's own icons (check, X); the rest say
// what they are with a ticket or a clock.
const STATUS_LOOK: Record<string, { variant: ChipVariant; icon?: LucideIcon }> = {
  valid: { variant: "neutral", icon: TicketIcon },
  checked_in: { variant: "positive" },
  void: { variant: "danger" },
  confirmed: { variant: "neutral", icon: TicketIcon },
  pending: { variant: "neutral", icon: Clock },
  waitlisted: { variant: "neutral", icon: Clock },
  cancelled: { variant: "danger" },
};

/** Status as a chip: icon + words, never colour alone. */
export function StatusTag({ status }: { status: string }) {
  const look = STATUS_LOOK[status] ?? { variant: "neutral" as const, icon: TicketIcon };
  return <StatusChip label={strings.status[status] ?? strings.status.unknown} variant={look.variant} icon={look.icon} />;
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

/** A row for the kit's ListGroup: date block, title, when, where, holder, status. Grows with text. */
function Row({ title, when, where, holder, status, day, onPress, testID }: RowProps) {
  const { colors } = useTheme();
  const statusLabel = strings.status[status] ?? strings.status.unknown;
  const a11y = [title, when, where, holder ? `${strings.myTickets.holder}: ${holder}` : null, statusLabel]
    .filter(Boolean)
    .join(". ");
  const body = (
    <>
      <DateBlock day={day} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="rowTitle">{title}</Text>
        <Text variant="caption" tone="secondary">
          {when}
        </Text>
        <Text variant="caption" tone="secondary">
          {where}
        </Text>
        {holder ? (
          <Text variant="caption" tone="secondary">
            {holder}
          </Text>
        ) : null}
        <View style={{ marginTop: space.xs }}>
          <StatusTag status={status} />
        </View>
      </View>
      {onPress ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignSelf: "center" }}>
          <ChevronRight size={18} color={colors.textTertiary} />
        </View>
      ) : null}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.md,
    paddingLeft: space.lg,
    paddingRight: space.md,
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
      style={({ pressed }) => [style, pressed ? { backgroundColor: colors.surfaceStrong } : null]}
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
