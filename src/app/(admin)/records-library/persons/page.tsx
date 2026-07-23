import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  listPersons,
  listImports,
  distinctPersonValues,
} from "@/services/records-library";
import { bestPersonName } from "@/lib/person-name";
import { PersonsBrowser } from "./persons-browser";

const PAGE_SIZE = 50;

export default async function LibraryPersonsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    import?: string;
    linked?: "all" | "linked" | "unlinked";
    country?: string;
    nationality?: string;
    sort?: "newest" | "oldest" | "name" | "email";
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "records-library");

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [personsRes, importsRes, countries, nationalities] = await Promise.all([
    listPersons(supabase, {
      search: sp.q ?? undefined,
      importId: sp.import ?? undefined,
      linkedStatus: (sp.linked as "all" | "linked" | "unlinked" | undefined) ?? "all",
      country: sp.country ?? undefined,
      nationality: sp.nationality ?? undefined,
      sort: sp.sort ?? "newest",
      limit: PAGE_SIZE,
      offset,
    }),
    listImports(supabase, { limit: 200 }),
    distinctPersonValues(supabase, "country"),
    distinctPersonValues(supabase, "nationality"),
  ]);

  const rows = (personsRes.data ?? []) as PersonRow[];
  const total = personsRes.count ?? 0;
  const imports = (importsRes.data ?? []) as ImportOption[];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">All library persons</h1>
          <p className="text-sm text-muted-foreground">
            Every person record across every CSV import. Use the filters and
            search below to find what you need.
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString()} person{total === 1 ? "" : "s"} match
        </p>
      </div>

      <PersonsBrowser
        initialQuery={sp.q ?? ""}
        importOptions={imports.map((i) => ({
          id: i.id,
          label: i.filename,
        }))}
        currentImport={sp.import ?? ""}
        currentLinked={sp.linked ?? "all"}
        currentCountry={sp.country ?? ""}
        currentNationality={sp.nationality ?? ""}
        currentSort={sp.sort ?? "newest"}
        countries={countries}
        nationalities={nationalities}
      />

      <div className="overflow-x-auto border rounded-md">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Email</th>
              <th className="text-left px-3 py-2 font-medium">Phone</th>
              <th className="text-left px-3 py-2 font-medium">DOB</th>
              <th className="text-left px-3 py-2 font-medium">Country</th>
              <th className="text-left px-3 py-2 font-medium">Source</th>
              <th className="text-left px-3 py-2 font-medium">Linked user</th>
              <th className="text-left px-3 py-2 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground italic">
                  No persons match these filters.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const linkedName = p.users
                  ? bestPersonName(p.users) || p.users.email
                  : null;
                return (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={`/records-library/persons/${p.id}`}
                        className="text-foreground hover:underline"
                      >
                        {bestPersonName(p)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.email ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.date_of_birth ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.country ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.source_import?.filename ? (
                        <Link
                          href={`/records-library/imports/${p.source_import.id}`}
                          className="hover:underline"
                        >
                          {p.source_import.filename}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {linkedName ? (
                        <Link
                          href={`/users/${p.users!.id}`}
                          className="text-emerald-300 hover:underline"
                        >
                          {linkedName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unlinked</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        baseSearch={sp}
      />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  baseSearch,
}: {
  page: number;
  totalPages: number;
  total: number;
  baseSearch: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(baseSearch)) {
      if (v && k !== "page") params.set(k, v);
    }
    params.set("page", String(p));
    return `/records-library/persons?${params.toString()}`;
  };
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground tabular-nums">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            className="px-3 py-1.5 border rounded-md hover:bg-muted"
          >
            ← Previous
          </Link>
        ) : (
          <span className="px-3 py-1.5 border rounded-md opacity-40 cursor-not-allowed">
            ← Previous
          </span>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            className="px-3 py-1.5 border rounded-md hover:bg-muted"
          >
            Next →
          </Link>
        ) : (
          <span className="px-3 py-1.5 border rounded-md opacity-40 cursor-not-allowed">
            Next →
          </span>
        )}
      </div>
    </div>
  );
}

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  country: string | null;
  nationality: string | null;
  linked_user_id: string | null;
  created_at: string;
  raw_data: Record<string, unknown> | null;
  source_import: { id: string; filename: string } | null;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

type ImportOption = { id: string; filename: string };
