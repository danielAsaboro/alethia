#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_home="$project_root/.local/qvac-home"
mkdir -p "$runtime_home/.qvac"
export SNAP_USER_COMMON="$runtime_home"

exec "$project_root/node_modules/.bin/qvac" serve openai \
  --config "$project_root/qvac.config.json" \
  --port 11436 \
  --host 127.0.0.1 \
  --model sourcetruce-extractor
