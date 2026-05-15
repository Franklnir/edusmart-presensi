#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[fail] env file tidak ditemukan: $ENV_FILE"
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -m1 "^${key}=" "$ENV_FILE" || true)"
  if [[ -z "$line" ]]; then
    printf '%s\n' ""
    return 0
  fi

  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s\n' "$value"
}

APP_URL="$(read_env_value APP_URL)"
TENANT_ADMIN_HOSTS="$(read_env_value TENANT_ADMIN_HOSTS)"
TENANT_ROOT_DOMAIN="$(read_env_value TENANT_ROOT_DOMAIN)"
TENANT_ADMIN_SUBDOMAIN="$(read_env_value TENANT_ADMIN_SUBDOMAIN)"
TENANT_ADMIN_SUBDOMAIN="${TENANT_ADMIN_SUBDOMAIN:-admin26}"
ADMIN_HOST="${TENANT_ADMIN_HOSTS%%,*}"
ADMIN_HOST="${ADMIN_HOST:-${TENANT_ADMIN_SUBDOMAIN}.${TENANT_ROOT_DOMAIN}}"

if [[ -z "$APP_URL" || -z "$ADMIN_HOST" ]]; then
  echo "[fail] APP_URL atau TENANT_ADMIN_HOSTS/TENANT_ROOT_DOMAIN belum lengkap"
  exit 1
fi

status_code() {
  curl -k -sS -o /dev/null -w '%{http_code}' "$@"
}

echo "== Security Smoke Check =="

health_code="$(status_code "${APP_URL%/}/api/health")"
if [[ "$health_code" == "200" ]]; then
  echo "[ok] health utama 200"
else
  echo "[fail] health utama status $health_code"
  exit 1
fi

blocked_code="$(status_code \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -A 'sqlmap/1.9.8.9#dev (https://sqlmap.org)' \
  --data '{"email":"test@example.com","password":"password"}' \
  "https://${ADMIN_HOST}/api/auth/login")"

if [[ "$blocked_code" == "403" ]]; then
  echo "[ok] scanner user-agent diblokir di admin host"
else
  echo "[fail] scanner user-agent status $blocked_code, expected 403"
  exit 1
fi

normal_code="$(status_code \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -A 'Mozilla/5.0 EduSmartSmokeCheck' \
  --data '{"email":"test@example.com","password":"password"}' \
  "https://${ADMIN_HOST}/api/auth/login")"

case "$normal_code" in
  401|403|422|429)
    echo "[ok] login normal tidak diblokir sebagai scanner (status $normal_code)"
    ;;
  *)
    echo "[fail] login normal memberi status tak terduga: $normal_code"
    exit 1
    ;;
esac

echo "Security smoke check lulus."
