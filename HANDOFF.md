# Golden Journey handoff

Updated: 2026-08-28 JST

## Repository state

- `origin/main`: `9764c7c525ed629be5cfc49ba8c8bb5780c70057`
- HEAD after the preflight handoff commit: `2bacd1458070f6d3814b6156483cdd615af2b52a`
- Working branch: `fix/300-303-non-ui-review`, tracking `origin/fix/300-303-non-ui`.

## Golden Journey progress

- Current step: preflight complete; production Golden Journey has **not started**.
- First blocking error was `git pull --ff-only` attempting to merge `refs/heads/pr-304`, which does not exist on `origin`.
- Resolution: the local branch now tracks `origin/fix/300-303-non-ui`; commit `2bacd14` is pushed there.
- Classification: local Git tracking configuration. It was neither an E2E failure, a Prizgram runtime failure, nor an infrastructure failure.

## Completed work

- Reviewed PR #304. Its #300 scoring-schema hardening is appropriate; it deliberately does not speculate about a #301 infrastructure fix.
- Fixed the PR's typecheck failure by replacing unsupported `toHaveTextContent` matchers in `apps/web/src/components/applications/application-update-form.test.tsx`.
- Validation already completed on the identical PR checkout: `pnpm typecheck`, 539 tests, Prettier, and lint all passed.

## Changed files and commits

- `apps/web/src/components/applications/application-update-form.test.tsx`
- `ba12a05 test(applications): use supported text assertion matcher`
- `2bacd14 docs: add golden journey handoff` (pushed)

## Prizgram issues

- #300: scoring `SCHEMA_VALIDATION_FAILED` (addressed by PR #304)
- #301: Cloudflare HTML 502 investigation (not changed by PR #304)
- #302: entry save/submit ordering (addressed by PR #304)
- #303: application update success state (addressed by PR #304)

## Required next commands

```bash
git pull --ff-only
E2E_BASE_URL=https://prizgram.kuraryu.jp E2E_ALLOW_MUTATION=true E2E_ALLOW_PRODUCTION=true pnpm test:golden
```

If `pnpm test:golden` is unavailable in this repository, locate the Golden Journey package/script before changing code; do not substitute a different test command.

## If the next run fails

- Confirm the E2E script location and its environment guards first (`package.json`, workspace configuration, CI workflow, or the separate Prizgram-E2E-test checkout).
- For an app JSON 502, inspect `apps/web/src/server/scoring/service.ts`, `apps/web/src/server/llm/client.ts`, and issue #300.
- For Cloudflare HTML 502, do not change Prizgram application code; capture `CF-Ray` and production web/cloudflared/systemd logs, then update issue #301.
