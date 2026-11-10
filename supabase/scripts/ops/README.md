# Ops scripts

These files are one-off data scripts. They are not migrations. Do not run them from the migration path.

Run them manually only after Jack approves.

- `f_program_leaders.sql` (F) must run after migration 313 and after 310 or 312. It has a single SA Experience 2027 keep/remove switch (`f316.remove_sa_exp_2027`). The default is keep.
- `h_48d733cb_cleanup.sql` (H) removes 45 stale program-scoped grants for `48d733cb`.

Both default to verify mode, which rolls the transaction back.

## Migration order (313 → 316)

- **Never re-run 313 after 316.** 313 replaces `has_permission`. Re-running it after 316 removes 316's finance scope rule (C), and Postgres raises no error. 313 now refuses to run once 316 is in place. Older copies of 313 do not have that guard, for example the one on the #543 branch (314). When applying from any branch, skip migrations that are already applied.
- 316 refuses to run unless 313 is applied (`has_permission_for` must already have the `is_active` check).
- 314 can run before or after 316. It redefines none of the functions or policies 316 changes.
