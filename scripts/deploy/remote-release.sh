#!/usr/bin/env bash

set -Eeuo pipefail

: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
: "${DEPLOY_SHA:?DEPLOY_SHA is required}"

release_directory="$DEPLOY_ROOT/releases/$DEPLOY_SHA"
current_link="$DEPLOY_ROOT/current"
shared_directory="$DEPLOY_ROOT/shared"
environment_file="$shared_directory/.env"
database_file="$shared_directory/data/prizgram.sqlite"
service_directory="$HOME/.config/systemd/user"
service_file="$service_directory/prizgram-web.service"
cloudflared_service_file="$service_directory/cloudflared-prizgram.service"
node_binary="${NODE_BINARY:-$HOME/.local/node/bin/node}"
pnpm_binary="${PNPM_BINARY:-$HOME/.local/bin/pnpm}"

[[ -d "$release_directory" ]] || {
  echo "Release directory does not exist: $release_directory" >&2
  exit 1
}
[[ -x "$node_binary" ]] || {
  echo "Node.js is not installed at $node_binary. Run scripts/deploy/bootstrap-user.sh first." >&2
  exit 1
}
[[ -x "$pnpm_binary" ]] || {
  echo "pnpm is not installed at $pnpm_binary. Run scripts/deploy/bootstrap-user.sh first." >&2
  exit 1
}
[[ -f "$environment_file" ]] || {
  echo "Missing production environment file: $environment_file" >&2
  exit 1
}
[[ -f "$release_directory/deploy/prizgram-web.service" ]] || {
  echo "Missing systemd unit in release: $release_directory/deploy/prizgram-web.service" >&2
  exit 1
}

mkdir -p "$shared_directory/data" "$shared_directory/backups" "$service_directory"

# Consistent pre-deploy backup using SQLite snapshot API (#178) with unique name (#216)
if [[ -f "$database_file" ]]; then
  timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  backup_file="$shared_directory/backups/prizgram-${timestamp}-${DEPLOY_SHA}.sqlite"
  if [[ -e "$backup_file" ]]; then
    backup_file="${backup_file%.sqlite}-$(date +%s%N).sqlite"
  fi
  echo "Creating pre-deploy snapshot: $backup_file"
  if ! sqlite3 "$database_file" ".backup '$backup_file'"; then
    echo "Backup failed; aborting deploy before migration" >&2
    exit 1
  fi
  integrity="$(sqlite3 "$backup_file" "PRAGMA integrity_check;" 2>&1 || true)"
  if [[ "$integrity" != "ok" ]]; then
    echo "Backup integrity_check failed: $integrity" >&2
    exit 1
  fi
  echo "Backup verified: $backup_file"
else
  echo "No existing database; skipping backup"
fi

export DATABASE_URL="file:$database_file"
export NODE_ENV=production
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"

cd "$release_directory"

# better-sqlite3 ships a Linux prebuilt in this release. Avoid rebuilding it
# on the unprivileged LXC, where a compiler toolchain is intentionally absent.
"$pnpm_binary" install --frozen-lockfile --prod=false --ignore-scripts
"$pnpm_binary" db:migrate
"$pnpm_binary" build

standalone_web_directory="$release_directory/apps/web/.next/standalone/apps/web"
standalone_migrations_directory="$standalone_web_directory/.next/drizzle"
mkdir -p "$standalone_migrations_directory"
cp -a "$release_directory/packages/db/drizzle/." "$standalone_migrations_directory/"

if [[ -d "$release_directory/apps/web/.next/static" ]]; then
  mkdir -p "$standalone_web_directory/.next"
  cp -a "$release_directory/apps/web/.next/static" "$standalone_web_directory/.next/"
fi
if [[ -d "$release_directory/apps/web/public" ]]; then
  cp -a "$release_directory/apps/web/public" "$standalone_web_directory/"
fi

install -m 0644 "$release_directory/deploy/prizgram-web.service" "$service_file"
ln -sfn "$release_directory" "$current_link"

systemctl --user daemon-reload
systemctl --user enable prizgram-web.service
systemctl --user restart prizgram-web.service

if [[ -f "$release_directory/deploy/cloudflared-prizgram.service" &&
  -f "$shared_directory/cloudflared.token" &&
  -x "$HOME/.local/bin/cloudflared" ]]; then
  install -m 0644 "$release_directory/deploy/cloudflared-prizgram.service" "$cloudflared_service_file"
  systemctl --user daemon-reload
  systemctl --user enable cloudflared-prizgram.service
  systemctl --user restart cloudflared-prizgram.service
fi

for attempt in {1..30}; do
  echo "Waiting for health check ($attempt/30)..."
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Deployment $DEPLOY_SHA is healthy."
    exit 0
  fi
  sleep 2
done

systemctl --user --no-pager --full status prizgram-web.service || true
echo "Deployment $DEPLOY_SHA did not become healthy." >&2
exit 1
