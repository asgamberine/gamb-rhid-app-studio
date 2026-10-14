#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_version="$(tr -d '\r\n' < "$root_dir/.nvmrc")"

active_node_version="$(node --version 2>/dev/null | tr -d '\r\n' || true)"
if [[ "$active_node_version" != "v$node_version" ]]; then
  printf 'Node v%s e necessario. Execute nvm use %s antes deste script.\n' "$node_version" "$node_version" >&2
  exit 1
fi

cd "$root_dir"
export ALLOW_OFFICIAL_RHID_PUNCH=false
printf 'Usando Node %s. Modo de teste ativo: envio oficial ao RHiD bloqueado.\n' "$active_node_version"
exec npm run dev
