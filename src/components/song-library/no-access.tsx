import pw from "./pw.module.css";

/** Shown when a library or songwriting read came back 403 / forbidden. */
export function NoAccessNote() {
  return (
    <div className={pw.empty}>
      <div className={pw.emptyTitle}>You don&apos;t have access</div>
      <p className={pw.emptyText}>If you think you should, ask the team that runs this.</p>
    </div>
  );
}
