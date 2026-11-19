// Who is asking: name and whether they are the owner. Read as the user.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function helperIdentity(supabase: Client, userId: string) {
  const [{ data: profile }, { data: isOwner }] = await Promise.all([
    supabase.from("users").select("first_name, last_name").eq("id", userId).maybeSingle(),
    supabase.rpc("legal_is_owner"),
  ]);
  const userName = profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || null : null;
  return { userName, isOwner: isOwner === true };
}
