#!/usr/bin/env bash
# Runs ON the production server after code sync (invoked by scripts/cd/deploy.sh).
# Order follows docs/deployment.md: install → DB backup → migrate → build → restart.
set -euo pipefail

cd "${DEPLOY_DIR:?DEPLOY_DIR is required}"
export SERVICE_RESTART_CMD="${SERVICE_RESTART_CMD:-sudo systemctl restart prizgram}"

echo "[server-update] deploy target: $(pwd) @ $(cat DEPLOY_COMMIT 2>/dev/null || echo 'unknown')"

echo "[server-update] pnpm install"
pnpm install --frozen-lockfile

if [[ -f data/prizgram.sqlite ]]; then
  echo "[server-update] db backup before migrate"
  ./scripts/backup-db.sh
else
  echo "[server-update] no database yet; skipping backup"
fi

echo "[server-update] migrate"
pnpm db:migrate

echo "[server-update] build"
pnpm build

echo "[server-update] restart ($SERVICE_RESTART_CMD)"
$SERVICE_RESTART_CMD
