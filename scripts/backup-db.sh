#!/usr/bin/env bash
# Logical hot backup of the SQLite database with retention.
# Usage: backup-db.sh [DB_FILE] [BACKUP_DIR] [KEEP_GENERATIONS]
set -euo pipefail

DB_FILE="${1:-/opt/prizgram/data/prizgram.sqlite}"
BACKUP_DIR="${2:-/var/backups/prizgram}"
KEEP="${3:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
TMP="$BACKUP_DIR/.prizgram-$STAMP.tmp"

sqlite3 "$DB_FILE" ".backup '$TMP'"
gzip -f "$TMP"
mv "$TMP.gz" "$BACKUP_DIR/prizgram-$STAMP.sqlite.gz"

# Retention: keep newest KEEP generations
ls -1t "$BACKUP_DIR"/prizgram-*.sqlite.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "backup written: $BACKUP_DIR/prizgram-$STAMP.sqlite.gz"
