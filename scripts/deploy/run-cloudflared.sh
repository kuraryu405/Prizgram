#!/usr/bin/env bash

set -Eeuo pipefail

token_file="$HOME/prizgram/shared/cloudflared.token"

[[ -f "$token_file" ]] || {
  echo "Missing Cloudflare Tunnel token file: $token_file" >&2
  exit 1
}
[[ -x "$HOME/.local/bin/cloudflared" ]] || {
  echo "cloudflared is not installed at $HOME/.local/bin/cloudflared" >&2
  exit 1
}

exec "$HOME/.local/bin/cloudflared" tunnel run --token-file "$token_file"
