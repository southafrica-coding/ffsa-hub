# Ops scripts

These files are one-off data scripts. They are not migrations. Do not run them from the migration path.

Run them manually only after Jack approves.

- `f_program_leaders.sql` (F) narrows the two program leaders to their own programs. It must run after migrations 313 and 316, and after 310 or 312; commit mode refuses to run otherwise.
  - Makaio (`41763eb6`): FFBX September 2026 only. His SA Experience 2027 grants are removed.
  - Enge (`542986ea`): Leadership Track Q4/2026 and SA Experience 2027 (hers are kept).
  - For both: every unscoped `schools.*` grant is deleted, scoped copies are added for their own programs where missing, and `schools.templates.manage` is granted org-wide.
  - Enge gets a `program_leaders` row for Leadership Track Q4/2026.
  - Makaio's finance is limited to FFBX (Jack, 10 Nov): his unscoped `finance.approve`, `finance.edit` and `finance.export` are deleted, and those keys plus `finance.view` are held scoped to FFBX (3 inserts; view @ FFBX exists). His unscoped `finance.view` stays, the same shape as 08c957a0, 666e334c and c380c569. Enge's finance is not touched.
  - Commit needs the exact per-person counts in `c_expected` (Makaio / Enge): deleted unscoped 6 / 6, deleted SA Exp 2027 7 / 0, scoped inserts 0 / 0, template key 1 / 1, `program_leaders` 0 / 1, deleted unscoped finance 3 / 0, scoped finance inserts 3 / 0.
- `stale_program_grants_cleanup.sql` deletes grants scoped to programs that no longer exist: `48d733cb` 45, `68f5d637` 10 and `62d623b0` 9 rows. It replaces `h_48d733cb_cleanup.sql`.
  - Switch 2 also removes `68f5d637`'s 4 grants on a deleted event (14 for that user in total: 10 on deleted program `a311977f`, and 4 on deleted event `2a80fbbe`). It is on by default, as Jack approved all 14.
  - Before and after the delete, the script checks each person's effective access to every key, at org-wide, program and event level. Any difference aborts, in both modes. Commit needs the exact counts.
  - It can run at any point in the migration order.

All of them default to verify mode, which rolls the transaction back and prints a `VERIFY_RESULTS` JSON with counts and before/after access.

## Migration order (313 → 316)

- **Never re-run 313 after 316.** 313 replaces `has_permission`. Re-running it after 316 removes 316's finance scope rule (C), and Postgres raises no error. 313 now refuses to run once 316 is in place. The copies of 313 on #542, #543 and #549 are identical and all carry that guard. Any older copy without it must never be applied. The guard only works if 313 runs as one transaction: use the Supabase migration runner, or `psql -1 -v ON_ERROR_STOP=1 -f 313_scope_aware_permissions.sql`. Without that, a raised guard error would not stop later statements, and the file would be partly re-applied. When applying from any branch, skip migrations that are already applied.
- 316 refuses to run unless 313 is applied (`has_permission_for` must already have the `is_active` check).
- 314 can run before or after 316. It redefines none of the functions or policies 316 changes.
- 316 seeds the `schools.templates.manage` permission. A trigger refuses any scoped grant of that key.
