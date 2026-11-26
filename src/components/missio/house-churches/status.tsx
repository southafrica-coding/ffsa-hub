"use client";

import { MissioApiError } from "../api";
import { NoAccess } from "../shell";
import { houseErrorCopy } from "./client";
import shell from "../shell.module.css";

export function accessStatus(error: unknown): 401 | 403 | null {
  if (!(error instanceof MissioApiError)) return null;
  if (error.code === "unauthenticated") return 401;
  if (error.code === "forbidden") return 403;
  return null;
}

export function HouseStatus({
  error,
  fallback,
  onRetry,
}: {
  error: unknown;
  fallback: string;
  onRetry: () => void;
}) {
  const status = accessStatus(error);
  if (status != null) return <NoAccess status={status} />;
  const message = error instanceof MissioApiError ? houseErrorCopy(error) : fallback;
  return (
    <div className={shell.state} data-state="error" role="alert">
      <p>{message}</p>
      <button type="button" className={shell.ghost} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
