#!/usr/bin/env bash
# CI-side deploy orchestrator. Requires (GitHub Environment `production`):
#   secrets: SSH_HOST, SSH_USER, SSH_PRIVATE_KEY
#   vars (optional): DEPLOY_DIR (/opt/prizgram), PROD_URL, SERVICE_RESTART_CMD
set -euo pipefail

: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_USER:?SSH_USER is required}"
: "${SSH_PRIVATE_KEY:?SSH_PRIVATE_KEY is required}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/prizgram}"
PROD_URL="${PROD_URL:-https://prizgram.kuraryu.jp}"
export SERVICE_RESTART_CMD="${SERVICE_RESTART_CMD:-sudo systemctl restart prizgram}"

SSH_OPTS=(-i "$HOME/.ssh/deploy_key" -o BatchMode=yes -o ConnectTimeout=10)
REMOTE="$SSH_USER@$SSH_HOST"

echo "[cd] preparing ssh key"
mkdir -p "$HOME/.ssh"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$HOME/.ssh/deploy_key"
chmod 600 "$HOME/.ssh/deploy_key"
ssh-keyscan -H "$SSH_HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null

git rev-parse HEAD > DEPLOY_COMMIT

# NOTE: no --delete on purpose; data/, .env and unknown server-local files must survive.
echo "[cd] rsync code to $REMOTE:$DEPLOY_DIR"
rsync -az \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude /data \
  --exclude /.env \
  --exclude coverage \
  --exclude test-results \
  --exclude playwright-report \
  ./ "$REMOTE:$DEPLOY_DIR/"

echo "[cd] running server-update on $REMOTE"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "cd '$DEPLOY_DIR' && DEPLOY_DIR='$DEPLOY_DIR' SERVICE_RESTART_CMD='$SERVICE_RESTART_CMD' bash scripts/cd/server-update.sh"

echo "[cd] waiting for $PROD_URL/api/health"
deadline=$((SECONDS + 90))
until curl -fsS -m 5 "$PROD_URL/api/health" > /dev/null; do
  if (( SECONDS >= deadline )); then
    echo "[cd] health check did not recover within 90s; see docs/deployment.md rollback section" >&2
    exit 1
  fi
  sleep 5
done

echo "[cd] deployed $(cat DEPLOY_COMMIT) successfully to $PROD_URL"
