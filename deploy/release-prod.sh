#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${EDUSMART_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
TARGET_REF=""
SKIP_BACKUP="false"
PULL_IMAGES="true"
AUTO_ROLLBACK="true"
RUN_EXTERNAL_SMOKE_CHECK="false"
APP_SERVICES=(backend worker scheduler rfid_bridge nginx caddy)
IMAGE_SERVICES=(backend nginx)
CORE_HEALTH_SERVICES=(postgres redis backend worker scheduler nginx caddy)
PREV_FULL_REF=""
PREV_REF=""
PREV_BACKEND_IMAGE=""
PREV_NGINX_IMAGE=""
DEPLOY_PHASE="preflight"
ROLLBACK_RUNNING="false"

usage() {
  cat <<'USAGE'
Usage:
  deploy/release-prod.sh --ref <git_ref> [options]

Options:
  --ref <git_ref>         Ref release (tag/branch/commit). Wajib.
  --env-file <path>       Path env file (default: .env.production)
  --compose-file <path>   Path docker compose file (default: docker-compose.prod.yml)
  --skip-backup           Lewati backup DB sebelum release
  --skip-build            Legacy alias; build lokal production sudah dinonaktifkan
  --pull-images           Pull image dari registry sebelum deploy (default)
  --no-pull-images        Jangan pull registry; pakai image lokal yang sudah ada, tetap tanpa build
  --no-auto-rollback      Jangan rollback otomatis bila deploy/health check gagal
  --external-smoke-check  Jalankan deploy/scripts/prod_smoke_check.sh setelah health check internal
  -h, --help              Tampilkan bantuan

Contoh:
  EDUSMART_BACKEND_IMAGE=ghcr.io/org/repo/backend:sha EDUSMART_NGINX_IMAGE=ghcr.io/org/repo/nginx:sha deploy/release-prod.sh --ref v1.5.0
  EDUSMART_BACKEND_IMAGE=ghcr.io/org/repo/backend:sha EDUSMART_NGINX_IMAGE=ghcr.io/org/repo/nginx:sha deploy/release-prod.sh --ref main --pull-images
USAGE
}

read_env_var() {
  local key="$1"
  local file="$2"

  awk -v key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (index(line, key "=") != 1) {
        next
      }

      value = substr(line, length(key) + 2)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)

      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }

      print value
      exit
    }
  ' "$file"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose_service_image() {
  local service="$1"
  local container_id
  container_id="$(compose ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    printf '%s\n' ""
    return 0
  fi

  docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true
}

check_compose_service() {
  local service="$1"
  local container_id
  local state

  container_id="$(compose ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    echo "[fail] service $service tidak punya container aktif" >&2
    return 1
  fi

  state="$(docker inspect --format '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$container_id")"
  case "$state" in
    running|running/healthy)
      echo "[ok] service $service: $state"
      ;;
    *)
      echo "[fail] service $service: $state" >&2
      return 1
      ;;
  esac
}

run_internal_health_checks() {
  local response

  echo "      - cek container inti"
  for service in "${CORE_HEALTH_SERVICES[@]}"; do
    check_compose_service "$service"
  done

  echo "      - cek endpoint API lokal"
  response="$(curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health")"
  if ! printf '%s' "$response" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "[fail] response /api/health tidak valid: $response" >&2
    return 1
  fi
  echo "[ok] /api/health status ok"

  echo "      - cek koneksi Laravel ke database"
  compose exec -T backend php artisan migrate:status --no-interaction >/dev/null
  echo "[ok] Laravel migrate:status sukses"
}

rollback_application() {
  if [[ "$AUTO_ROLLBACK" != "true" || "$ROLLBACK_RUNNING" == "true" ]]; then
    return 0
  fi
  if [[ -z "$PREV_FULL_REF" ]]; then
    echo "[rollback] ref lama tidak tersedia, rollback otomatis dilewati." >&2
    return 0
  fi

  ROLLBACK_RUNNING="true"
  set +e

  echo "[rollback] Deploy gagal setelah fase: $DEPLOY_PHASE" >&2
  echo "[rollback] Mengembalikan aplikasi ke ref: $PREV_REF" >&2

  git checkout "$PREV_FULL_REF"
  local checkout_status=$?
  if [[ "$checkout_status" -ne 0 ]]; then
    echo "[rollback] checkout ref lama gagal." >&2
    set -e
    return "$checkout_status"
  fi

  if [[ -n "$PREV_BACKEND_IMAGE" ]]; then
    export EDUSMART_BACKEND_IMAGE="$PREV_BACKEND_IMAGE"
  fi
  if [[ -n "$PREV_NGINX_IMAGE" ]]; then
    export EDUSMART_NGINX_IMAGE="$PREV_NGINX_IMAGE"
  fi

  compose up -d --no-build "${APP_SERVICES[@]}"
  local compose_status=$?
  if [[ "$compose_status" -ne 0 ]]; then
    echo "[rollback] compose up ref lama gagal." >&2
    set -e
    return "$compose_status"
  fi

  compose exec -T backend php artisan optimize:clear >/dev/null
  curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null
  local health_status=$?

  if [[ "$health_status" -eq 0 ]]; then
    echo "[rollback] Aplikasi kembali sehat di ref $PREV_REF." >&2
  else
    echo "[rollback] Rollback selesai, tapi health check masih gagal. Cek log VPS." >&2
  fi

  set -e
  return "$health_status"
}

handle_failure() {
  local exit_code="$?"
  local line="${1:-unknown}"

  echo "Error: release gagal pada fase '$DEPLOY_PHASE' (line $line, exit $exit_code)." >&2

  if [[ "$DEPLOY_PHASE" != "preflight" ]]; then
    rollback_application || true
  fi

  exit "$exit_code"
}

trap 'handle_failure $LINENO' ERR

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      TARGET_REF="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="${2:-}"
      shift 2
      ;;
    --skip-backup)
      SKIP_BACKUP="true"
      shift
      ;;
    --skip-build)
      PULL_IMAGES="true"
      shift
      ;;
    --pull-images)
      PULL_IMAGES="true"
      shift
      ;;
    --no-pull-images)
      PULL_IMAGES="false"
      shift
      ;;
    --no-auto-rollback)
      AUTO_ROLLBACK="false"
      shift
      ;;
    --external-smoke-check)
      RUN_EXTERNAL_SMOKE_CHECK="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_REF" ]]; then
  echo "Error: --ref wajib diisi." >&2
  usage
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: env file tidak ditemukan: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Error: compose file tidak ditemukan: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree tidak bersih. Commit/stash dulu sebelum release." >&2
  exit 1
fi

DB_USERNAME="$(read_env_var DB_USERNAME "$ENV_FILE")"
DB_DATABASE="$(read_env_var DB_DATABASE "$ENV_FILE")"
HEALTH_PORT="$(read_env_var NGINX_HTTP_PORT "$ENV_FILE")"
HEALTH_PORT="${HEALTH_PORT:-80}"

if [[ -z "$DB_USERNAME" || -z "$DB_DATABASE" ]]; then
  echo "Error: DB_USERNAME / DB_DATABASE belum terdefinisi di $ENV_FILE" >&2
  exit 1
fi

echo "[1/9] Fetch refs terbaru..."
git fetch --all --tags --prune
git rev-parse --verify "$TARGET_REF" >/dev/null

PREV_FULL_REF="$(git rev-parse HEAD)"
PREV_REF="$(git rev-parse --short HEAD)"
PREV_BACKEND_IMAGE="$(compose_service_image backend)"
PREV_NGINX_IMAGE="$(compose_service_image nginx)"

echo "[2/9] Checkout release ref: $TARGET_REF"
git checkout "$TARGET_REF"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups"
RELEASE_BACKUP="${BACKUP_DIR}/pre-release-${TIMESTAMP}.sql.gz"

if [[ "$SKIP_BACKUP" != "true" ]]; then
  echo "[3/9] Backup DB sebelum deploy: $RELEASE_BACKUP"
  mkdir -p "$BACKUP_DIR"
  compose exec -T postgres \
    pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
    | gzip >"$RELEASE_BACKUP"
else
  echo "[3/9] Skip backup DB (--skip-backup)"
fi

DEPLOY_PHASE="pull_images"
if [[ "$PULL_IMAGES" == "true" ]]; then
  echo "[4/9] Pull image registry..."
  compose pull \
    "${IMAGE_SERVICES[@]}"
else
  echo "[4/9] Lewati pull image registry (--no-pull-images)"
fi
DEPLOY_PHASE="restart_services"
echo "[5/9] Deploy service tanpa build lokal..."
compose up -d --no-build \
  "${APP_SERVICES[@]}"

DEPLOY_PHASE="migrate"
echo "[6/9] Jalankan migrasi..."
compose exec -T backend php artisan migrate --force

DEPLOY_PHASE="clear_cache"
echo "[7/9] Clear optimize cache..."
compose exec -T backend php artisan optimize:clear >/dev/null

DEPLOY_PHASE="health_check"
echo "[8/9] Health check internal..."
run_internal_health_checks

if [[ "$RUN_EXTERNAL_SMOKE_CHECK" == "true" ]]; then
  DEPLOY_PHASE="external_smoke_check"
  echo "[8/9] Smoke check eksternal..."
  ENV_FILE="$ROOT_DIR/$ENV_FILE" COMPOSE_FILE="$ROOT_DIR/$COMPOSE_FILE" "$ROOT_DIR/deploy/scripts/prod_smoke_check.sh"
fi

DEPLOY_PHASE="done"
echo "[9/9] Selesai."
echo "Release aktif : $(git rev-parse --short HEAD)"
echo "Release lama  : $PREV_REF"
if [[ "$SKIP_BACKUP" != "true" ]]; then
  echo "Backup DB     : $RELEASE_BACKUP"
fi
echo "Rollback cepat: EDUSMART_BACKEND_IMAGE=${PREV_BACKEND_IMAGE:-<image-lama>} EDUSMART_NGINX_IMAGE=${PREV_NGINX_IMAGE:-<image-lama>} deploy/rollback-prod.sh --ref $PREV_REF"
