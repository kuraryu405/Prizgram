#!/usr/bin/env bash

set -Eeuo pipefail

install_directory="$HOME/.local/bin"
mkdir -p "$install_directory"

case "$(uname -m)" in
  x86_64) artifact="cloudflared-linux-amd64" ;;
  aarch64|arm64) artifact="cloudflared-linux-arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

curl --fail --location --silent --show-error \
  "https://github.com/cloudflare/cloudflared/releases/latest/download/$artifact" \
  --output "$install_directory/cloudflared"
chmod 755 "$install_directory/cloudflared"
"$install_directory/cloudflared" version
