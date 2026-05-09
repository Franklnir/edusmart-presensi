#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${EDUSMART_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
TARGET_REF=""
SKIP_BACKUP="false"
PULL_IMAGES="true"
APP_SERVICES=(backend worker scheduler rfid_bridge nginx caddy)
IMAGE_SERVICES=(backend nginx)

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

echo "[1/8] Fetch refs terbaru..."
git fetch --all --tags --prune
git rev-parse --verify "$TARGET_REF" >/dev/null

PREV_REF="$(git rev-parse --short HEAD)"
echo "[2/8] Checkout release ref: $TARGET_REF"
git checkout "$TARGET_REF"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups"
RELEASE_BACKUP="${BACKUP_DIR}/pre-release-${TIMESTAMP}.sql.gz"

if [[ "$SKIP_BACKUP" != "true" ]]; then
  echo "[3/8] Backup DB sebelum deploy: $RELEASE_BACKUP"
  mkdir -p "$BACKUP_DIR"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
    | gzip >"$RELEASE_BACKUP"
else
  echo "[3/8] Skip backup DB (--skip-backup)"
fi

if [[ "$PULL_IMAGES" == "true" ]]; then
  echo "[4/8] Pull image registry..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull \
    "${IMAGE_SERVICES[@]}"
else
  echo "[4/8] Lewati pull image registry (--no-pull-images)"
fi
echo "[4/8] Deploy service tanpa build lokal..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build \
  "${APP_SERVICES[@]}"

echo "[5/8] Jalankan migrasi..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend php artisan migrate --force

echo "[6/8] Clear optimize cache..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend php artisan optimize:clear >/dev/null

echo "[7/8] Smoke test health endpoint..."
curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null

echo "[8/8] Selesai."
echo "Release aktif : $(git rev-parse --short HEAD)"
echo "Release lama  : $PREV_REF"
if [[ "$SKIP_BACKUP" != "true" ]]; then
  echo "Backup DB     : $RELEASE_BACKUP"
fi
echo "Rollback cepat: deploy/rollback-prod.sh --ref $PREV_REF"
