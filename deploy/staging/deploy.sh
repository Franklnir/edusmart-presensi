#!/usr/bin/env bash

set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${1:-$root_dir/.env.staging}"
cd "$root_dir"

deploy/staging/preflight.sh "$env_file"

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

compose=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$env_file" -f docker-compose.staging.yml)

for image in "$EDUSMART_BACKEND_IMAGE" "$EDUSMART_NGINX_IMAGE" "$EDUSMART_CADDY_IMAGE"; do
  docker image inspect "$image" >/dev/null
done

previous_sha=""
if [[ -f .staging-current-release ]]; then
  previous_sha="$(tr -cd '0-9a-f' < .staging-current-release | head -c 40)"
fi

"${compose[@]}" up -d --wait postgres redis minio
"${compose[@]}" up --no-deps --force-recreate storage-init

"${compose[@]}" run --rm --no-deps backend php artisan migrate --force
"${compose[@]}" run --rm --no-deps backend php artisan db:seed --class='Database\Seeders\StagingUploadFixtureSeeder' --force

"${compose[@]}" up -d --remove-orphans --scale backend=2 backend worker scheduler nginx caddy

for attempt in {1..12}; do
  if "${compose[@]}" exec -T backend php artisan staging:verify-runtime --wait=20; then
    break
  fi
  if [[ "$attempt" -eq 12 ]]; then
    echo "[staging-deploy] runtime verification did not become healthy" >&2
    exit 1
  fi
  sleep 10
done

health_url="https://${STAGING_BACKEND_HOST}/api/health"
health_body="$(curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 5 "$health_url")"
if [[ "$health_body" != *"\"release_sha\":\"$RELEASE_SHA\""* ]]; then
  echo "[staging-deploy] public health response does not match release SHA" >&2
  exit 1
fi

if [[ -n "$previous_sha" && "$previous_sha" != "$RELEASE_SHA" ]]; then
  printf '%s\n' "$previous_sha" > .staging-previous-release
fi
printf '%s\n' "$RELEASE_SHA" > .staging-current-release

"${compose[@]}" ps
echo "[staging-deploy] release $RELEASE_SHA is healthy with two backend replicas"
