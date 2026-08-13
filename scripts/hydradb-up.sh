#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$project_root/.hydradb/store" "$project_root/.hydradb/cache"
if [[ ! -f "$project_root/.hydradb/auth-token" ]]; then
  printf '%s\n' 'local-development-token-32-bytes' > "$project_root/.hydradb/auth-token"
fi

export HYDRA_UID="$(id -u)"
export HYDRA_GID="$(id -g)"
docker compose --project-directory "$project_root" up -d hydradb
