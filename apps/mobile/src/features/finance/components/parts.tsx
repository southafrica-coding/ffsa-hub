// Finance's own pieces for the redesign (frames 3.1–3.10): the budget bar
// with its figures. The general pieces first built here (section title,
// group rows, bleed, pushed page, load states) now live in src/components.

import { TriangleAlert } from "lucide-react-native";
import { View } from "react-native";

import { StatusLine, Text } from "@/components";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { barFill, formatMoney, moneyLabel, type BudgetFigures } from "../money";
import { strings } from "../strings";

// ── Budget bar: figures and words always shown, never colour alone ─────────

export function BudgetBar({ figures, currency, compact = false }: { figures: BudgetFigures; currency: string; compact?: boolean }) {
  const { colors } = useTheme();
  const fill = barFill(figures.ratio);
  const whole = { cents: false };
  const summary =
    figures.ratio === null
      ? strings.team.noBudget
      : figures.over
        ? `${strings.team.over} by ${formatMoney(-figures.remaining, currency, whole)}`
        : `${figures.pctSpent}% spent`;
  const spokenSummary =
    figures.ratio === null
      ? strings.team.noBudget
      : figures.over
        ? `${strings.team.over} by ${moneyLabel(-figures.remaining, currency, whole)}`
        : `${figures.pctSpent} percent spent`;
  const label = `${strings.team.budget} ${moneyLabel(figures.total, currency, whole)}, ${strings.team.spent} ${moneyLabel(figures.spent, currency, whole)}, ${strings.team.remaining} ${moneyLabel(figures.remaining, currency, whole)}. ${spokenSummary}.`;
  const words = compact ? `${formatMoney(figures.spent, currency, whole)} of ${formatMoney(figures.total, currency, whole)} · ${summary}` : summary;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={figures.pctSpent === null ? undefined : { min: 0, max: 100, now: Math.min(100, Math.floor(figures.pctSpent)) }}
      style={{ gap: compact ? space.xs : space.sm }}
    >
      {!compact ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: space.xs }}>
          <Figure label={strings.team.budget} value={formatMoney(figures.total, currency, whole)} />
          <Figure label={strings.team.spent} value={formatMoney(figures.spent, currency, whole)} />
          <Figure label={strings.team.remaining} value={formatMoney(figures.remaining, currency, whole)} danger={figures.over} />
        </View>
      ) : null}
      {figures.ratio !== null ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.rule, overflow: "hidden" }}>
          <View testID="budget-bar-fill" style={{ height: 6, width: `${fill * 100}%`, backgroundColor: figures.over ? colors.danger : colors.text }} />
        </View>
      ) : null}
      {figures.over ? (
        <StatusLine icon={TriangleAlert} tone="danger">
          {words}
        </StatusLine>
      ) : (
        <Text variant="caption" tone="secondary">
          {words}
        </Text>
      )}
    </View>
  );
}

function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <View>
      <Text variant="label">{label}</Text>
      <Text variant="sectionTitle" tone={danger ? "danger" : "default"} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}
