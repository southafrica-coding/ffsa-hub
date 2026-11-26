import { formatMoney, moneyLabel, type MoneyOptions } from "@/features/finance/money";

import { Text, type TextProps } from "./Text";

export type MoneyTextProps = Omit<TextProps, "children"> & {
  amount: number;
  currency?: string | null;
  /** formatMoney options: `{ cents: false }` for whole rands on budget summaries. */
  options?: MoneyOptions;
};

/**
 * Money exactly as features/finance/money.ts formats it ("R 3 240.00", no-break
 * spaces so it never splits), in tabular figures. Spoken with moneyLabel.
 */
export function MoneyText({ amount, currency, options, variant = "body", style, accessibilityLabel, ...rest }: MoneyTextProps) {
  return (
    <Text
      variant={variant}
      accessibilityLabel={accessibilityLabel ?? moneyLabel(amount, currency, options)}
      {...rest}
      style={[{ fontVariant: ["tabular-nums"] }, style]}
    >
      {formatMoney(amount, currency, options)}
    </Text>
  );
}
