#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[fail] env file tidak ditemukan: $ENV_FILE"
  exit 1
fi

FAILURES=0

note_ok() {
  echo "[ok] $1"
}

note_fail() {
  echo "[fail] $1"
  FAILURES=1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    note_fail "command wajib tidak tersedia: $1"
    exit 1
  fi
}

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

host_from_url() {
  local url="$1"
  url="${url#http://}"
  url="${url#https://}"
  url="${url%%/*}"
  url="${url%%:*}"
  printf '%s\n' "$url"
}

check_dns() {
  local host="$1"
  [[ -z "$host" ]] && return 0
  if getent ahosts "$host" >/dev/null 2>&1; then
    note_ok "DNS resolve untuk $host"
  else
    if [[ -n "${TENANT_DNS_A_RECORD:-}" ]]; then
      note_fail "DNS belum resolve untuk $host. Arahkan A record ke ${TENANT_DNS_A_RECORD}"
    else
      note_fail "DNS belum resolve untuk $host"
    fi
  fi
}

check_https_health() {
  local url="$1"
  local label="$2"
  local http_code
  http_code="$(curl -k -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ "$http_code" == "200" ]]; then
    note_ok "$label merespons 200"
  else
    note_fail "$label merespons $http_code"
  fi
}

check_container_state() {
  local container="$1"
  local state
  state="$(docker inspect --format '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
  case "$state" in
    running|running/healthy)
      note_ok "container $container dalam kondisi $state"
      ;;
    *)
      note_fail "container $container bermasalah: ${state:-tidak ditemukan}"
      ;;
  esac
}

check_admin_login() {
  local host="$1"
  [[ -z "${SMOKE_SUPER_ADMIN_EMAIL:-}" || -z "${SMOKE_SUPER_ADMIN_PASSWORD:-}" ]] && return 0

  local payload
  payload="$(printf '{"email":"%s","password":"%s"}' "$SMOKE_SUPER_ADMIN_EMAIL" "$SMOKE_SUPER_ADMIN_PASSWORD")"

  local http_code
  http_code="$(curl -k -sS -o /tmp/edusmart-admin-login.json -w '%{http_code}' \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/json' \
    --data "$payload" \
    "https://${host}/api/auth/login" || true)"

  if [[ "$http_code" == "200" ]]; then
    note_ok "login super admin ke ${host} berhasil"
    rm -f /tmp/edusmart-admin-login.json
  else
    note_fail "login super admin ke ${host} gagal dengan status ${http_code}"
  fi
}

require_cmd docker
require_cmd curl
require_cmd getent

APP_URL="$(read_env_value APP_URL)"
TENANT_ADMIN_HOSTS="$(read_env_value TENANT_ADMIN_HOSTS)"
CADDY_EVOLUTION_HOST="$(read_env_value CADDY_EVOLUTION_HOST)"
TENANT_DNS_A_RECORD="$(read_env_value TENANT_DNS_A_RECORD)"

APP_HOST="$(host_from_url "${APP_URL:-}")"
ADMIN_HOST="${TENANT_ADMIN_HOSTS%%,*}"
EVOLUTION_HOST="${CADDY_EVOLUTION_HOST:-}"

echo "== DNS =="
check_dns "$APP_HOST"
check_dns "$ADMIN_HOST"
check_dns "$EVOLUTION_HOST"

echo
echo "== HTTPS =="
check_https_health "${APP_URL%/}/api/health" "health utama"
if [[ -n "$ADMIN_HOST" ]]; then
  check_https_health "https://${ADMIN_HOST}/api/health" "health admin"
fi
if [[ -n "$EVOLUTION_HOST" ]]; then
  check_https_health "https://${EVOLUTION_HOST}" "host Evolution publik"
fi

echo
echo "== Containers =="
check_container_state "edusmart-caddy"
check_container_state "edusmart-nginx"
check_container_state "edusmart-backend"
check_container_state "edusmart-worker"
check_container_state "edusmart-scheduler"
check_container_state "edusmart-rfid-bridge"
check_container_state "edusmart-postgres"
check_container_state "edusmart-redis"
check_container_state "edusmart-evolution-api"
check_container_state "edusmart-evolution-postgres"
check_container_state "edusmart-evolution-redis"

echo
echo "== Compose Snapshot =="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo
echo "== Optional Login =="
if [[ -n "${SMOKE_SUPER_ADMIN_EMAIL:-}" && -n "${SMOKE_SUPER_ADMIN_PASSWORD:-}" ]]; then
  check_admin_login "$ADMIN_HOST"
else
  echo "[skip] set SMOKE_SUPER_ADMIN_EMAIL dan SMOKE_SUPER_ADMIN_PASSWORD untuk uji login admin"
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "Semua smoke check lulus."
else
  echo "Smoke check menemukan masalah."
fi

exit "$FAILURES"
