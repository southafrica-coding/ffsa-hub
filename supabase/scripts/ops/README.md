# Ops scripts

These files are one-off data scripts. They are not migrations. Do not run them from the migration path.

Run them manually only after Jack approves.

- `f_program_leaders.sql` (F) must run after migration 313 and after 310 or 312. It has a single SA Experience 2027 keep/remove switch (`f316.remove_sa_exp_2027`). The default is keep.
- `h_48d733cb_cleanup.sql` (H) removes 45 stale program-scoped grants for `48d733cb`.

Both default to verify mode, which rolls the transaction back.
