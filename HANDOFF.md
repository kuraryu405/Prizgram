# Golden Journey handoff

Updated: 2026-08-28 10:52 JST

## Repository state

- Prizgram Git `origin/main`: `0c292c7bff55c17adfcc29d381cef6109b119ea3` (merged #306 / closed #305)
- Deployed production release: `d1948a1083ed19d2b7c69cde9575d566f970ba85` (unchanged; healthy)
- Working branch: `fix/307-sqlite-backup`
- Code HEAD before this HANDOFF commit: `59458b12fa0774a109d6683474b3e0a957d3f796`

## Golden Journey current step

- Steps 01--07 passed in prior production runs.
- Step 08c `POST /api/applications/:id/interview-followup` failed because of the now-fixed #305 structured-output boundary.
- #306 fixes #305, but production Golden must not be rerun until the safe manual deployment path is repaired and the new release is active.

## Latest error summary

Attempting canonical manual deployment of merged #306 (`0c292c7...`) stopped at the pre-deploy SQLite snapshot step:

```text
scripts/deploy/remote-release.sh: line 90: sqlite3: command not found
Backup failed; aborting deploy before migration
Restarting previous service after backup failure...
```

Safety verification after abort:

- No migration ran and `current` did not change.
- Existing web service restarted successfully and is `active/running`.
- `http://127.0.0.1:3000/api/health` returned 200 / `status: ok`.

## Classification

- E2E-origin: **No**.
- Prizgram body-origin: **#305 fixed in merged #306 but not yet deployed**.
- Infra/deployment-origin: **Yes for the deployment blocker**. The production host lacks the `sqlite3` CLI that the backup shell script required.

## This phase's fix

- `packages/db/scripts/sqlite-backup.mjs`
  - New Node helper uses the already installed `better-sqlite3` SQLite backup API and checks `PRAGMA integrity_check` before returning success.
- `scripts/deploy/remote-release.sh`
  - Uses the helper instead of the unavailable `sqlite3` CLI.
  - Retains the existing backup-failure cleanup and previous-service restart guard; it does not bypass the backup.
- `eslint.config.mjs`
  - Disables type-aware lint only for the direct Node deployment helper outside the TypeScript project graph.
- No UI code, CSS, components, database schema, migration, or production state changed in this phase.

## Verification completed

- Local real SQLite integration: create source DB → helper snapshot → `integrity_check` → read backed-up row, passed.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (55 files / 542 tests), and `pnpm build`, passed.
- `bash -n scripts/deploy/remote-release.sh` and `node --check packages/db/scripts/sqlite-backup.mjs`, passed.

## Commits and issues

- `59458b12fa0774a109d6683474b3e0a957d3f796` — `fix(deploy): remove sqlite3 CLI backup dependency`; pushed to `origin/fix/307-sqlite-backup`.
- **#307** — deployment backup prerequisite failure: https://github.com/kuraryu405/Prizgram/issues/307
- #305 is closed by merged #306; #301 remains an infra fallback only for unmatched Cloudflare HTML 502 errors.

## Unresolved items

1. Create and merge a PR from `fix/307-sqlite-backup` to `main`.
2. Re-deploy the resulting `main` SHA through the canonical script. Require a verified SQLite snapshot before migration or symlink switch.
3. Verify `current` points to the deployed SHA and `/api/health` is 200.
4. Run the complete production Golden Journey and inspect final screenshots/MP4 for UI regression. If a first failure remains, follow the required cycle.

## Next commands

```bash
gh pr create --base main --head fix/307-sqlite-backup \
  --title "fix(deploy): remove sqlite3 CLI backup dependency" \
  --body "Fixes #307"
gh pr merge <PR-number> --merge --delete-branch

# Upload the merged SHA, then only run the canonical release script:
DEPLOY_ROOT=/home/prizgram-deploy/prizgram DEPLOY_SHA=<merged-sha> \
bash /home/prizgram-deploy/prizgram/releases/<merged-sha>/scripts/deploy/remote-release.sh

# After health/release verification, from Prizgram-E2E-test:
git pull --ff-only
pnpm typecheck
E2E_BASE_URL=https://prizgram.kuraryu.jp \
E2E_ALLOW_MUTATION=true \
E2E_ALLOW_PRODUCTION=true \
pnpm test:golden
```

## If the next run fails, inspect these first

- Before release switch: `packages/db/scripts/sqlite-backup.mjs`, `scripts/deploy/remote-release.sh`, backup path, and `PRAGMA integrity_check` output.
- Step 08 after deployment: `apps/web/src/server/interview-ai/schemas.ts`, `apps/web/src/server/interview-ai/service.ts`, and #305 / #306 history.
- A Cloudflare HTML 502 without matching origin error: #301 and production web/tunnel journals.
- Step 10--14: use the E2E repository's `HANDOFF.md` routing map.

## Required cycle

`run -> diagnose first failure -> smallest safe fix -> typecheck -> commit/push -> update HANDOFF.md -> rerun`

Do not leave uncommitted changes while starting a new investigation.
