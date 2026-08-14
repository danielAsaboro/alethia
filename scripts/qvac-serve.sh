#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_home="$project_root/.local/qvac-home"
runtime_config="$project_root/.local/qvac.runtime.config.json"
"$project_root/scripts/fetch-qvac-model.sh" --verify-only
node "$project_root/scripts/render-qvac-runtime-config.mjs"
mkdir -p "$runtime_home/.qvac"
export SNAP_USER_COMMON="$runtime_home"
cd "$project_root"

exec "$project_root/node_modules/.bin/qvac" serve openai \
  --config "$runtime_config" \
  --port 11436 \
  --host 127.0.0.1 \
  --model sourcetruce-extractor
