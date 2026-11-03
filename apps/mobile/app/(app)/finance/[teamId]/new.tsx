import { useLocalSearchParams } from "expo-router";

import ExpenseScreen from "@/features/finance/screens/ExpenseScreen";

export default function NewExpenseRoute() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  return <ExpenseScreen teamId={teamId} />;
}
