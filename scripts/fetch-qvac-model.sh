#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
model_dir="$project_root/.local/models"
model_name="Qwen3.8-27B-UD-Q4_K_XL.gguf"
model_path="$model_dir/$model_name"
partial_path="$model_path.partial"
model_url="https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/27af057ecb382ddfea5d12837360a8980560e3ed/$model_name"
expected_size="17559178144"
expected_sha256="3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e"
verify_only="${1:-}"

if [[ -n "$verify_only" && "$verify_only" != "--verify-only" ]]; then
  printf 'Usage: %s [--verify-only]\n' "$0" >&2
  exit 2
fi

file_size() {
  stat -f %z "$1" 2>/dev/null || stat -c %s "$1"
}

file_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  printf 'Neither shasum nor sha256sum is available for model verification\n' >&2
  return 1
}

verify_model() {
  local candidate="$1"
  local actual_size=""
  local actual_sha256=""
  actual_size="$(file_size "$candidate")"
  if [[ "$actual_size" != "$expected_size" ]]; then
    return 1
  fi
  actual_sha256="$(file_sha256 "$candidate")"
  [[ "$actual_sha256" == "$expected_sha256" ]]
}

mkdir -p "$model_dir"

if [[ -f "$model_path" ]] && verify_model "$model_path"; then
  printf 'Verified Qwen3.8 model: %s\n' "$model_path"
  exit 0
fi

if [[ "$verify_only" == "--verify-only" ]]; then
  printf 'QVAC model is missing or failed verification: %s\nRun: npm run qvac:model:fetch\n' "$model_path" >&2
  exit 1
fi

curl \
  --fail \
  --location \
  --retry 5 \
  --retry-delay 2 \
  --continue-at - \
  --output "$partial_path" \
  "$model_url"

if ! verify_model "$partial_path"; then
  printf 'Downloaded model failed size or SHA-256 verification: %s\n' "$partial_path" >&2
  exit 1
fi

mv "$partial_path" "$model_path"
printf 'Downloaded and verified Qwen3.8 model: %s\n' "$model_path"
