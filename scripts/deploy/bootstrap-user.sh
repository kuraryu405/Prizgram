#!/usr/bin/env bash

set -Eeuo pipefail

node_version="22.15.1"
pnpm_version="10.15.1"
install_root="$HOME/.local"
node_root="$install_root/node"
bin_directory="$install_root/bin"

case "$(uname -m)" in
  x86_64) node_arch="x64" ;;
  aarch64|arm64) node_arch="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

mkdir -p "$install_root" "$bin_directory"

if [[ ! -x "$node_root/bin/node" || "$("$node_root/bin/node" --version 2>/dev/null || true)" != "v$node_version" ]]; then
  archive="node-v$node_version-linux-$node_arch.tar.xz"
  temporary_directory="$(mktemp -d)"
  trap 'rm -rf "$temporary_directory"' EXIT
  curl --fail --location --silent --show-error \
    "https://nodejs.org/dist/v$node_version/$archive" \
    --output "$temporary_directory/$archive"
  rm -rf "$node_root"
  tar -xJf "$temporary_directory/$archive" -C "$temporary_directory"
  mv "$temporary_directory/node-v$node_version-linux-$node_arch" "$node_root"
fi

export PATH="$node_root/bin:$bin_directory:$PATH"
"$node_root/bin/npm" install --global --prefix "$install_root" "pnpm@$pnpm_version"

printf 'Node.js: %s\n' "$(node --version)"
printf 'pnpm: %s\n' "$(pnpm --version)"
