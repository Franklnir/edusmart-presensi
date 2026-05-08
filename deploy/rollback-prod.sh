#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${EDUSMART_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
TARGET_REF=""
RESTORE_DB_FILE=""
SKIP_PRE_BACKUP="false"
APP_SERVICES=(backend worker scheduler rfid_bridge nginx caddy)

usage() {
  cat <<'USAGE'
Usage:
  deploy/rollback-prod.sh --ref <git_ref> [options]

Options:
  --ref <git_ref>         Git ref rollback target (contoh: v1.2.3 atau commit SHA)
  --env-file <path>       Path env production (default: .env.production)
  --compose-file <path>   Path docker compose file (default: docker-compose.prod.yml)
  --restore-db <file>     Restore DB dari file .sql / .sql.gz setelah checkout ref
  --skip-pre-backup       Lewati backup DB sebelum rollback
  -h, --help              Tampilkan bantuan

Contoh:
  deploy/rollback-prod.sh --ref v1.4.2
  deploy/rollback-prod.sh --ref 8d4a1f2 --restore-db backups/pre-release-2026-02-21.sql.gz
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
    --restore-db)
      RESTORE_DB_FILE="${2:-}"
      shift 2
      ;;
    --skip-pre-backup)
      SKIP_PRE_BACKUP="true"
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

if [[ -n "$RESTORE_DB_FILE" && ! -f "$RESTORE_DB_FILE" ]]; then
  echo "Error: file restore DB tidak ditemukan: $RESTORE_DB_FILE" >&2
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

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree tidak bersih. Commit/stash dulu sebelum rollback." >&2
  exit 1
fi

CURRENT_REF="$(git rev-parse --short HEAD)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups"
PRE_ROLLBACK_BACKUP="${BACKUP_DIR}/pre-rollback-${TIMESTAMP}.sql.gz"

echo "[1/7] Fetch git refs..."
git fetch --all --tags --prune
git rev-parse --verify "$TARGET_REF" >/dev/null

if [[ "$SKIP_PRE_BACKUP" != "true" ]]; then
  echo "[2/7] Membuat backup DB sebelum rollback: $PRE_ROLLBACK_BACKUP"
  mkdir -p "$BACKUP_DIR"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
    | gzip >"$PRE_ROLLBACK_BACKUP"
else
  echo "[2/7] Skip backup DB sebelum rollback (--skip-pre-backup)"
fi

echo "[3/7] Checkout target ref: $TARGET_REF"
git checkout "$TARGET_REF"

echo "[4/7] Rebuild & restart service produksi..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build \
  "${APP_SERVICES[@]}"

if [[ -n "$RESTORE_DB_FILE" ]]; then
  echo "[5/7] Restore database dari: $RESTORE_DB_FILE"
  if [[ "$RESTORE_DB_FILE" == *.gz ]]; then
    gunzip -c "$RESTORE_DB_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$DB_USERNAME" "$DB_DATABASE"
  else
    cat "$RESTORE_DB_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$DB_USERNAME" "$DB_DATABASE"
  fi
else
  echo "[5/7] Skip restore DB (pakai schema/data yang sedang aktif)"
fi

echo "[6/7] Refresh cache aplikasi..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend php artisan optimize:clear >/dev/null

echo "[7/7] Verifikasi health API..."
curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null

echo "Rollback selesai."
echo "Current ref : $(git rev-parse --short HEAD)"
echo "Previous ref: $CURRENT_REF"
if [[ "$SKIP_PRE_BACKUP" != "true" ]]; then
  echo "DB backup   : $PRE_ROLLBACK_BACKUP"
fi
