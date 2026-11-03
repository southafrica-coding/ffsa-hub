import { useLocalSearchParams } from "expo-router";

import ExpenseScreen from "@/features/finance/screens/ExpenseScreen";

export default function ExpenseRoute() {
  const { teamId, expenseId } = useLocalSearchParams<{ teamId: string; expenseId: string }>();
  return <ExpenseScreen teamId={teamId} expenseId={expenseId} />;
}
