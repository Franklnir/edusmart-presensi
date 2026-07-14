#!/usr/bin/env bash

set -Eeuo pipefail

env_file="${1:-.env.staging}"
if [[ ! -f "$env_file" ]]; then
  echo "[staging-preflight] environment file is missing" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

required=(
  COMPOSE_PROJECT_NAME RELEASE_SHA
  EDUSMART_BACKEND_IMAGE EDUSMART_NGINX_IMAGE EDUSMART_CADDY_IMAGE
  STAGING_POSTGRES_IMAGE STAGING_REDIS_IMAGE STAGING_MINIO_IMAGE STAGING_MINIO_MC_IMAGE
  STAGING_FRONTEND_HOST STAGING_BACKEND_HOST STAGING_STORAGE_HOST STAGING_TENANT_ROOT_DOMAIN
  STAGING_ACME_EMAIL APP_KEY DB_DATABASE DB_USERNAME DB_PASSWORD REDIS_PASSWORD
  REDIS_PREFIX CACHE_PREFIX HORIZON_PREFIX TENANT_EDGE_PROXY_SECRET
  STAGING_STORAGE_ACCESS_KEY STAGING_STORAGE_SECRET_KEY STAGING_STORAGE_BUCKET
  STAGING_TEST_PASSWORD
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[staging-preflight] required staging value is missing: $name" >&2
    exit 1
  fi
done

if [[ ! "$COMPOSE_PROJECT_NAME" =~ ^edusmart_staging_[a-z0-9_-]+$ ]]; then
  echo "[staging-preflight] COMPOSE_PROJECT_NAME must use edusmart_staging_*" >&2
  exit 1
fi

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[staging-preflight] RELEASE_SHA must be a full immutable commit SHA" >&2
  exit 1
fi

for image in "$EDUSMART_BACKEND_IMAGE" "$EDUSMART_NGINX_IMAGE" "$EDUSMART_CADDY_IMAGE"; do
  if [[ "$image" != *":$RELEASE_SHA" ]]; then
    echo "[staging-preflight] application images must be tagged with RELEASE_SHA" >&2
    exit 1
  fi
done

for image in "$STAGING_POSTGRES_IMAGE" "$STAGING_REDIS_IMAGE" "$STAGING_MINIO_IMAGE" "$STAGING_MINIO_MC_IMAGE"; do
  if [[ "$image" == *:latest || "$image" != *:* ]]; then
    echo "[staging-preflight] infrastructure images must use explicit non-latest tags" >&2
    exit 1
  fi
done

for host in "$STAGING_FRONTEND_HOST" "$STAGING_BACKEND_HOST" "$STAGING_STORAGE_HOST"; do
  host="${host,,}"
  host="${host%.}"
  if [[ "$host" == "sismu.biz.id" || "$host" == "origin.sismu.biz.id" ]]; then
    echo "[staging-preflight] production host is forbidden" >&2
    exit 1
  fi
  if [[ "$host" == *"://"* || "$host" == */* ]]; then
    echo "[staging-preflight] staging host values must contain hostnames only" >&2
    exit 1
  fi
done

if [[ "$STAGING_FRONTEND_HOST" == "$STAGING_BACKEND_HOST" || "$STAGING_FRONTEND_HOST" == "$STAGING_STORAGE_HOST" || "$STAGING_BACKEND_HOST" == "$STAGING_STORAGE_HOST" ]]; then
  echo "[staging-preflight] frontend, backend, and storage hosts must be distinct" >&2
  exit 1
fi

if [[ "${DB_DATABASE,,}" != *staging* || "${STAGING_STORAGE_BUCKET,,}" != *staging* ]]; then
  echo "[staging-preflight] database and bucket names must visibly identify staging" >&2
  exit 1
fi

for prefix in "$REDIS_PREFIX" "$CACHE_PREFIX" "$HORIZON_PREFIX"; do
  if [[ "$prefix" != edusmart:staging:* ]]; then
    echo "[staging-preflight] all Redis prefixes must begin with edusmart:staging:" >&2
    exit 1
  fi
done

if [[ ${#STAGING_TEST_PASSWORD} -lt 16 ]]; then
  echo "[staging-preflight] synthetic account password does not meet minimum length" >&2
  exit 1
fi

if [[ "${STAGING_SESSION_DOMAIN:-}" == ".sismu.biz.id" ]]; then
  echo "[staging-preflight] production-wide cookie domain is forbidden" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  docker compose --env-file "$env_file" -f docker-compose.staging.yml config --quiet
fi

echo "[staging-preflight] isolated staging configuration accepted"
