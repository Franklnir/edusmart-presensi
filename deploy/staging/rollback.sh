#!/usr/bin/env bash

set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${1:-$root_dir/.env.staging}"
cd "$root_dir"

if [[ ! -f .staging-previous-release ]]; then
  echo "[staging-rollback] no verified previous release is recorded" >&2
  exit 1
fi

previous_sha="$(tr -cd '0-9a-f' < .staging-previous-release | head -c 40)"
if [[ ! "$previous_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[staging-rollback] previous release record is invalid" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

repo="${EDUSMART_BACKEND_IMAGE%/backend:*}"
export RELEASE_SHA="$previous_sha"
export EDUSMART_BACKEND_IMAGE="$repo/backend:$previous_sha"
export EDUSMART_NGINX_IMAGE="$repo/nginx:$previous_sha"
export EDUSMART_CADDY_IMAGE="$repo/caddy:$previous_sha"

temporary_env="$(mktemp)"
trap 'rm -f "$temporary_env"' EXIT
awk '!/^(RELEASE_SHA|EDUSMART_BACKEND_IMAGE|EDUSMART_NGINX_IMAGE|EDUSMART_CADDY_IMAGE)=/' "$env_file" > "$temporary_env"
{
  printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA"
  printf 'EDUSMART_BACKEND_IMAGE=%s\n' "$EDUSMART_BACKEND_IMAGE"
  printf 'EDUSMART_NGINX_IMAGE=%s\n' "$EDUSMART_NGINX_IMAGE"
  printf 'EDUSMART_CADDY_IMAGE=%s\n' "$EDUSMART_CADDY_IMAGE"
} >> "$temporary_env"

deploy/staging/deploy.sh "$temporary_env"
echo "[staging-rollback] rollback to immutable release $previous_sha passed"
