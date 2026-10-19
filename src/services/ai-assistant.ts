// Data access for the in-app Hub assistant (chat bubble).
// Table: ai_assistant_queries (migration 254).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Usage / daily limit
// ────────────────────────────────────────────────────────────

/** Tokens this user has used since `since` (input + output, all questions). */
export async function sumAssistantTokensSince(
  supabase: Client,
  userId: string,
  since: Date
): Promise<{ tokens: number; error: unknown }> {
  const { data, error } = await supabase
    .from("ai_assistant_queries")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString())
    .limit(2000);
  if (error) return { tokens: 0, error };
  const tokens = ((data ?? []) as Array<{ input_tokens: number; output_tokens: number }>).reduce(
    (sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0
  );
  return { tokens, error: null };
}

// ────────────────────────────────────────────────────────────
// Audit log
// ────────────────────────────────────────────────────────────

export async function logAssistantQuery(
  supabase: Client,
  row: {
    user_id: string;
    page_path: string | null;
    question: string;
    tool_calls: Array<{ name: string; input: unknown }>;
    answer: string | null;
    model_used: string;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
  }
) {
  return supabase.from("ai_assistant_queries").insert(row);
}
