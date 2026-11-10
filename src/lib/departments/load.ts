import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

/**
 * Reads a departments API response.
 * 401 sends the person to login. 403 and 404 are the not-found page
 * (inactive accounts and homes the API will not open). Anything else
 * throws, so the page does not render a partial result.
 */
export class DepartmentApiError extends Error {
  readonly status: number;

  constructor(status: number, message = "Department API failed") {
    super(message);
    this.name = "DepartmentApiError";
    this.status = status;
  }
}

export type DepartmentOutcome = "ok" | "login" | "not-found" | "error";

export function outcomeForStatus(status: number): DepartmentOutcome {
  if (status === 401) return "login";
  if (status === 403 || status === 404) return "not-found";
  if (status >= 200 && status < 300) return "ok";
  return "error";
}

export function applyDepartmentOutcome(status: number): void {
  const outcome = outcomeForStatus(status);
  if (outcome === "login") redirect("/login");
  if (outcome === "not-found") notFound();
  if (outcome === "error") throw new DepartmentApiError(status);
}

export async function loadDepartmentApi<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) throw new DepartmentApiError(0, "Department API host is missing");

  const cookie = (await cookies())
    .getAll()
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  let response: Response;
  try {
    response = await fetchImpl(`${proto}://${host}${path}`, {
      cache: "no-store",
      headers: cookie ? { cookie } : {},
    });
  } catch (error) {
    throw new DepartmentApiError(0, error instanceof Error ? error.message : "Department API failed");
  }

  applyDepartmentOutcome(response.status);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new DepartmentApiError(response.status, error instanceof Error ? error.message : "Department API failed");
  }
}
