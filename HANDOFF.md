# Golden Journey handoff

Updated: 2026-08-28 10:22 JST

## Repository state

- Prizgram `origin/main`: `d1948a1083ed19d2b7c69cde9575d566f970ba85` (currently deployed production release)
- Working branch: `fix/305-interview-ai-schema`
- Code HEAD before this HANDOFF commit: `173fb468e61a9b73a371f6a722559127dcf7a894`
- Code commits already pushed:
  - `436c44d90c6bb5805dac052a6e2afb4870086a37` — `fix(interview-ai): normalize structured generation output`
  - `173fb468e61a9b73a371f6a722559127dcf7a894` — `test(persona-update): make re-evaluation order deterministic`

## Golden Journey current step

- Steps **01--07 pass** on production.
- Step **08c: interview follow-up generation** is the current first failing operation.
- The exact request is `POST /api/applications/:id/interview-followup`.
- The next production Golden must start at Step 01 so that the final evidence remains one continuous video.

## Error summary and classification

- Browser: Cloudflare HTML `502 Bad gateway` after the E2E helper's three bounded retries for a side-effect-free generation call.
- Origin correlation: every retry logged `UPSTREAM_INVALID_RESPONSE`, caused by `LlmClientError SCHEMA_VALIDATION_FAILED: The normalized content did not match its domain schema`.
- `prizgram-web.service` and `cloudflared-prizgram.service` both had `NRestarts=0`; web cgroup `oom=0`, `oom_kill=0`.
- Classification: **Prizgram body defect**, not E2E or infra. The Cloudflare HTML response masks the origin 502 body.

## This phase's fix

- `apps/web/src/server/interview-ai/schemas.ts`
  - Adds provider-side cardinality limits compatible with OpenAI strict JSON Schema.
  - Normalizes provider text before domain validation: trim, drop blank list items, cap list sizes and text lengths, omit blank optional STAR fields.
  - Preserves domain validation and the existing persona-grounded evidence guard.
- `apps/web/src/server/interview-ai/schemas.test.ts`
  - Adds provider-to-domain and OpenAI-schema regression coverage.
- `apps/web/src/server/persona-update/service.test.ts`
  - Makes pre-existing re-evaluation ordering fixture timestamps deterministic; no runtime/UI behavior changed.
- No UI components, styles, or client flow code changed.

## Verification completed

- `pnpm typecheck` — passed.
- `pnpm test` — 55 files / 542 tests passed.
- pre-push `pnpm build` — passed.
- Prettier and ESLint pre-commit checks — passed.

## Prizgram issues

- **#305** — interview AI structured-output schema failure; this branch implements the fix: https://github.com/kuraryu405/Prizgram/issues/305
- #301 is infra-only fallback for a future Cloudflare HTML 502 without a matching application error.
- #300 / merged PR #304 fixed the analogous scoring problem.

## Unresolved items

1. Create and merge the PR for `fix/305-interview-ai-schema` into `main` (user authorized merge).
2. Verify CD deploys a main SHA newer than `d1948a1` before touching production Golden.
3. Run the full production Golden. Its evidence screenshots/MP4 are the UI-regression proof; inspect all 14 steps rather than assuming backend-only edits cannot affect visible behavior.
4. If Golden finds another Prizgram-body defect, create/update its issue rather than hiding it in E2E.
5. Remove the temporary E2E production-Golden workflow only after a complete passing run.

## Next commands

```bash
gh pr create --base main --head fix/305-interview-ai-schema \
  --title "fix(interview-ai): normalize structured generation output" \
  --body "Fixes #305"
gh pr merge <PR-number> --merge --delete-branch

# Wait for CD, then from Prizgram-E2E-test:
git pull --ff-only
pnpm typecheck
E2E_BASE_URL=https://prizgram.kuraryu.jp \
E2E_ALLOW_MUTATION=true \
E2E_ALLOW_PRODUCTION=true \
pnpm test:golden
```

## If the next run fails, inspect these first

- Step 08: `apps/web/src/server/interview-ai/schemas.ts`, `apps/web/src/server/interview-ai/service.ts`, `apps/web/src/server/llm/client.ts`, and #305.
- A Cloudflare HTML 502 lacking an origin app error: #301, then production web/tunnel journals and cgroup OOM counters.
- Step 10: E2E `src/support/applications.ts`.
- Step 11--12: E2E `src/support/persona-update.ts` and the corresponding service/routes.
- Step 13: E2E `src/support/dashboard.ts`.
- Step 14: E2E `tests/acceptance/golden-journey.spec.ts` and account/session helpers.

## Required cycle

`run -> diagnose first failure -> smallest safe fix -> typecheck -> commit/push -> update HANDOFF.md -> rerun`

Do not leave uncommitted changes while starting a new investigation.
