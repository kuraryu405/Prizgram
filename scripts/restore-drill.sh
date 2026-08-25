#!/usr/bin/env bash
# Restore drill: expand the newest backup into a temp DB and verify it.
# Usage: restore-drill.sh [BACKUP_DIR]
set -euo pipefail

BACKUP_DIR="${1:-/var/backups/prizgram}"
LATEST="$(ls -1t "$BACKUP_DIR"/prizgram-*.sqlite.gz 2>/dev/null | head -n 1)"
if [[ -z "${LATEST}" ]]; then
  echo "no backups found in $BACKUP_DIR" >&2
  exit 1
fi

TMP="$(mktemp -d /tmp/prizgram-restore.XXXXXX)"
gunzip -c "$LATEST" > "$TMP/restored.sqlite"

INTEGRITY="$(sqlite3 "$TMP/restored.sqlite" "pragma integrity_check;")"
if [[ "$INTEGRITY" != "ok" ]]; then
  echo "integrity_check FAILED: $INTEGRITY" >&2
  exit 1
fi

echo "restored: $LATEST"
echo "integrity_check: ok"
sqlite3 "$TMP/restored.sqlite" \
  "select 'users', count(*) from users union all select 'applications', count(*) from applications union all select 'deadlines', count(*) from application_deadlines;"
rm -rf "$TMP"
echo "drill passed"
