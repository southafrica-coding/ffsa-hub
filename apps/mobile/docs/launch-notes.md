# Launch notes — Phase 0 (NOT run; for Jack's Mac, zsh)

Prepared 1 Nov 2026. Nothing here has been executed. The Mac was offline, so **verify `claude --help` flags on the Mac first** (flag names/pattern syntax below are from memory and unverified on this box).

Order: (0) copy files to the Mac, (1) create worktrees, (2) launch both prompts in parallel (they touch different branches; PR 2 only needs PR 1 at runtime), (3) read logs.

## 0. Copy the prompts + docs to the Mac (needs the Mac online; the parent can do this with CopyFromBox)
Copy `/workspace/ffsahub-mobile/prompts/*` and `plan.md`, `design-tokens.md`, `api-surface.md`, `permissions-matrix.md`, `feature-inventory.md` into `~/CODING/mobile-prompts/` (prompts reference that folder).

```zsh
mkdir -p ~/CODING/mobile-prompts/logs
# after copying: ls ~/CODING/mobile-prompts   # expect web-api-auth.txt mobile-scaffold.txt plan.md design-tokens.md ...
```

## 1. Worktrees (new branches from the latest origin/main; `--no-track` so nothing pushes to main by accident)
```zsh
REPO=~/CODING/ffsa-platform
cd "$REPO" && git fetch origin --prune

git worktree add --no-track -b feat/mobile-api-bearer-auth ~/CODING/ffsa-mobile-api origin/main
git worktree add --no-track -b feat/mobile-scaffold        ~/CODING/ffsa-mobile-scaffold origin/main

# git's "node_modules/" ignore pattern does NOT match a symlink, so ignore the link locally
echo 'node_modules' >> "$(git rev-parse --git-common-dir)/info/exclude"

# Web checks (tsc/lint/vitest/build) need the web dependencies: link, never `npm install` in a worktree root
ln -s "$REPO/node_modules" ~/CODING/ffsa-mobile-api/node_modules
ln -s "$REPO/node_modules" ~/CODING/ffsa-mobile-scaffold/node_modules   # for web regression checks only

# apps/mobile does NOT use the link: it gets its OWN install, done inside apps/mobile by the scaffold prompt
# (the prompt removes the root link with plain `rm node_modules` to prove isolation, then restores it).

# sanity
git worktree list
git -C ~/CODING/ffsa-mobile-api status -sb
git -C ~/CODING/ffsa-mobile-scaffold status -sb
```
Make sure `~/CODING/ffsa-platform` has `node_modules` installed and is clean/up to date first (`git -C "$REPO" status -sb`). If an `.env.local` is needed for `npm run build`, the prompts say to use dummy values from `.env.example`; do not symlink real secrets.

## 2. Launch (zsh quirk: a plain `$DIS` string is NOT word-split in zsh, so use an array and expand it as `"${DIS[@]}"`; the prompt goes in via stdin because `--allowedTools`/`--disallowedTools` are variadic and would swallow a positional prompt)
```zsh
ALLOW=(Bash Read Edit Write Glob Grep)

DIS=(
  'Bash(git push*--force*)' 'Bash(git push*-f *)' 'Bash(git push*-f)' 'Bash(git push*+*)'
  'Bash(git push*--delete*)' 'Bash(git push*main*)' 'Bash(git push*master*)'
  'Bash(git reset --hard*)' 'Bash(git reset*--hard*)' 'Bash(git clean*)'
  'Bash(git checkout main*)' 'Bash(git switch main*)' 'Bash(git branch -D*)' 'Bash(git branch -d*)'
  'Bash(gh pr merge*)' 'Bash(gh pr close*)' 'Bash(gh pr ready*)' 'Bash(gh pr review*)' 'Bash(gh pr comment*)'
  'Bash(gh api*)' 'Bash(gh repo*)' 'Bash(gh release*)' 'Bash(gh workflow*)' 'Bash(gh secret*)' 'Bash(gh auth*)' 'Bash(gh issue*)'
  'Bash(supabase*)' 'Bash(npx supabase*)'
  'Bash(vercel*)' 'Bash(npx vercel*)'
  'Bash(eas*)' 'Bash(npx eas*)' 'Bash(eas-cli*)'
  'Bash(rm -rf*)' 'Bash(rm -fr*)' 'Bash(rm -r*)' 'Bash(rm -f -r*)' 'Bash(sudo*)'
  'Bash(curl*)' 'Bash(wget*)'
)
# NOTE: `gh pr create` and `gh pr edit` stay allowed (draft PRs + descriptions); `gh pr view/diff/list` allowed.
# If a pattern blocks something legitimate, the run will say so in the log; loosen deliberately, never with --dangerously-skip-permissions.

LOGDIR=~/CODING/mobile-prompts/logs
TS=$(date +%Y%m%d-%H%M%S)

# --- PR 1: bearer-token API auth ---
cd ~/CODING/ffsa-mobile-api
nohup claude -p --allowedTools "${ALLOW[@]}" --disallowedTools "${DIS[@]}" \
  < ~/CODING/mobile-prompts/web-api-auth.txt \
  > "$LOGDIR/web-api-auth-$TS.log" 2>&1 &
echo "api pid $!"

# --- PR 2: mobile scaffold (runs in parallel) ---
cd ~/CODING/ffsa-mobile-scaffold
nohup claude -p --allowedTools "${ALLOW[@]}" --disallowedTools "${DIS[@]}" \
  < ~/CODING/mobile-prompts/mobile-scaffold.txt \
  > "$LOGDIR/mobile-scaffold-$TS.log" 2>&1 &
echo "scaffold pid $!"
```
Quoting check: single quotes keep `*`, `(`, `)` literal in zsh; `"${DIS[@]}"` passes each pattern as its own argument. Test the expansion safely first: `print -l -- "${DIS[@]}" | head`.
If `claude` rejects the `Bash(...:*)`-less wildcard style on your version, switch each to the documented prefix form `Bash(git push:*)` etc. (more conservative: `Bash(git push --force:*)`, `Bash(git push -f:*)`); verify with `claude --help` / docs on the Mac.
Optional: add `--permission-mode acceptEdits` or `--max-turns <n>` if your CLI supports them (unverified). Do NOT use `--dangerously-skip-permissions`.

## 3. Watch / stop
```zsh
tail -f "$LOGDIR"/web-api-auth-*.log        # Ctrl-C stops tailing only
tail -f "$LOGDIR"/mobile-scaffold-*.log
pgrep -fl "claude -p"                       # is it still running?
kill <pid>                                  # stop one (normal TERM)
git -C ~/CODING/ffsa-mobile-api log --oneline -5
gh pr list --state open --draft             # expect two new DRAFT PRs
```

## 4. Afterwards (all manual, Jack)
- Review both draft PRs; nothing merges or deploys without his OK. PR 1's migration (rate-limit table) is applied by hand in the Supabase SQL editor, only if/when he approves it.
- Clean up worktrees only after the PRs are done: `git worktree remove ~/CODING/ffsa-mobile-api` (the node_modules link is just a link; this never deletes the main node_modules; do not use `rm -rf` on a worktree that contains the link).
- If PR 2's last push (workflow file) was rejected for token scope, run the `git mv` command quoted in its PR description.

## Known rough edges
- Variadic flags: keep the prompt on stdin as shown.
- `git push*main*` also blocks pushes of branches whose name contains "main" (none planned).
- Disabling `gh api` and `curl` means the runs cannot fetch docs; the prompts tell them to rely on npm metadata and what they know, and to flag unverified items.
- `claude -p` flag syntax and the pattern semantics above are unverified on this box (no CLI here).
