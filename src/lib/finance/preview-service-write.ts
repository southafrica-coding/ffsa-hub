/**
 * Preview deployments share the live database. Vercel sets VERCEL_ENV to
 * "preview" on those URLs. A signed-in session can still pass the budget
 * policies and write that shared database, so the workbook create and save
 * routes refuse every write there. This is not a service-role check.
 *
 * This file does not set VERCEL_ENV.
 */

export type PreviewWriteBlock = {
  error: "preview_writes_disabled";
  message: string;
};

const PREVIEW_MESSAGE = "This preview deployment cannot change budgets.";

export function serviceRoleWriteBlock(): PreviewWriteBlock | null {
  return previewBudgetWriteBlocked();
}

/** Fail closed before any workbook write. The signed-in client is not called. */
export function previewBudgetWriteBlocked(): PreviewWriteBlock | null {
  if (process.env.VERCEL_ENV === "preview") {
    return { error: "preview_writes_disabled", message: PREVIEW_MESSAGE };
  }
  return null;
}

type ErrorResult = { data: null; error: { code: "preview_writes_disabled"; message: string } };

function refusedQuery(block: PreviewWriteBlock) {
  const result: ErrorResult = { data: null, error: { code: block.error, message: block.message } };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: ErrorResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const chain = () => builder;
  for (const method of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "is",
    "in",
    "order",
    "limit",
    "single",
    "maybeSingle",
    "filter",
  ]) {
    builder[method] = chain;
  }
  return builder;
}

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

function wrapBuilder(builder: unknown, block: PreviewWriteBlock | null): unknown {
  if (!builder || (typeof builder !== "object" && typeof builder !== "function")) return builder;
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === "then" && typeof (target as { then?: unknown }).then === "function") {
        const then = (target as { then: (...args: unknown[]) => unknown }).then;
        return (onFulfilled: unknown, onRejected: unknown) => then.call(target, onFulfilled, onRejected);
      }
      if (block && typeof prop === "string" && WRITE_METHODS.has(prop)) {
        return () => refusedQuery(block);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result && typeof result === "object") return wrapBuilder(result, block);
        return result;
      };
    },
  });
}

/**
 * Reads on the wrapped client go through. On a preview deployment, insert,
 * update, upsert, delete and rpc resolve as preview_writes_disabled and the
 * underlying client is not asked to write.
 */
export function guardServiceRoleClient<T extends object>(client: T): T {
  const block = serviceRoleWriteBlock();
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "rpc") {
        return (...args: unknown[]) => {
          if (block) return Promise.resolve({ data: null, error: { code: block.error, message: block.message } });
          const rpc = (target as { rpc?: (...args: unknown[]) => unknown }).rpc;
          if (typeof rpc !== "function") {
            return Promise.resolve({ data: null, error: { message: "rpc is not available" } });
          }
          return rpc.apply(target, args);
        };
      }
      if (prop === "from") {
        return (table: string) => {
          const from = (target as { from?: (name: string) => unknown }).from;
          if (typeof from !== "function") return refusedQuery(block ?? { error: "preview_writes_disabled", message: PREVIEW_MESSAGE });
          return wrapBuilder(from.call(target, table), block);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}
