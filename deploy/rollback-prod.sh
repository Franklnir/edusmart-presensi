#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${EDUSMART_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
TARGET_REF=""
RESTORE_DB_FILE=""
SKIP_PRE_BACKUP="false"
APP_SERVICES=(backend worker scheduler rfid_bridge nginx caddy mosquitto mosquitto_reloader mosquitto_cert_sync)
IMAGE_SERVICES=(backend nginx)
COMPOSE_FILES=()
MOSQUITTO_CONFIG_CHANGED="false"

usage() {
  cat <<'USAGE'
Usage:
  deploy/rollback-prod.sh --ref <git_ref> [options]

Options:
  --ref <git_ref>         Git ref rollback target (contoh: v1.2.3 atau commit SHA)
  --env-file <path>       Path env production (default: .env.production)
  --compose-file <path>   Path docker compose file. Bisa diulang untuk override.
  --restore-db <file>     Restore DB dari file .sql / .sql.gz setelah checkout ref
  --skip-pre-backup       Lewati backup DB sebelum rollback
  -h, --help              Tampilkan bantuan

Contoh:
  EDUSMART_BACKEND_IMAGE=ghcr.io/org/repo/backend:sha EDUSMART_NGINX_IMAGE=ghcr.io/org/repo/nginx:sha EDUSMART_CADDY_IMAGE=ghcr.io/org/repo/caddy:sha deploy/rollback-prod.sh --ref v1.4.2
  EDUSMART_BACKEND_IMAGE=ghcr.io/org/repo/backend:sha EDUSMART_NGINX_IMAGE=ghcr.io/org/repo/nginx:sha EDUSMART_CADDY_IMAGE=ghcr.io/org/repo/caddy:sha deploy/rollback-prod.sh --ref 8d4a1f2 --restore-db backups/pre-release-2026-02-21.sql.gz
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

split_words() {
  local value="$1"
  # shellcheck disable=SC2206
  SPLIT_WORDS_RESULT=($value)
}

split_colon_paths() {
  local value="$1"
  local old_ifs="$IFS"
  IFS=':'
  # shellcheck disable=SC2206
  SPLIT_PATHS_RESULT=($value)
  IFS="$old_ifs"
}

compose_args() {
  local args=(--env-file "$ENV_FILE")
  local file

  for file in "${COMPOSE_FILES[@]}"; do
    args+=(-f "$file")
  done

  printf '%s\0' "${args[@]}"
}

compose() {
  local args=()
  local item

  while IFS= read -r -d '' item; do
    args+=("$item")
  done < <(compose_args)

  docker compose "${args[@]}" "$@"
}

git_ref_has_path() {
  local ref="$1"
  local path="$2"

  git cat-file -e "$ref:$path" 2>/dev/null
}

detect_mosquitto_config_change() {
  local from_ref="$1"
  local to_ref="$2"
  local path="deploy/mosquitto/mosquitto.conf"

  if ! git_ref_has_path "$from_ref" "$path" && ! git_ref_has_path "$to_ref" "$path"; then
    return 1
  fi

  if ! git_ref_has_path "$from_ref" "$path" || ! git_ref_has_path "$to_ref" "$path"; then
    return 0
  fi

  ! git diff --quiet "$from_ref" "$to_ref" -- "$path"
}

compose_has_service() {
  local service="$1"

  compose config --services | grep -qx "$service"
}

recreate_mosquitto_after_config_change() {
  local services=(mosquitto)

  if [[ "$MOSQUITTO_CONFIG_CHANGED" != "true" ]]; then
    return 0
  fi

  if ! compose_has_service mosquitto; then
    echo "[warn] Config Mosquitto berubah, tetapi service mosquitto tidak ada di compose aktif." >&2
    return 0
  fi

  if compose_has_service mosquitto_reloader; then
    services+=(mosquitto_reloader)
  fi

  echo "      - recreate Mosquitto karena konfigurasi broker berubah"
  compose up -d --no-build --force-recreate --no-deps "${services[@]}"
}

prune_missing_compose_files() {
  local existing=()
  local file

  for file in "${COMPOSE_FILES[@]}"; do
    if [[ -f "$file" ]]; then
      existing+=("$file")
    else
      echo "[warn] compose file $file tidak ada di ref target, dilewati." >&2
    fi
  done

  if [[ "${#existing[@]}" -eq 0 ]]; then
    echo "Error: tidak ada compose file yang tersedia setelah checkout." >&2
    exit 1
  fi

  COMPOSE_FILES=("${existing[@]}")
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
      COMPOSE_FILES+=("${2:-}")
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

if [[ "${#COMPOSE_FILES[@]}" -eq 0 ]]; then
  ENV_COMPOSE_FILES="${EDUSMART_COMPOSE_FILES:-$(read_env_var EDUSMART_COMPOSE_FILES "$ENV_FILE")}"
  if [[ -n "$ENV_COMPOSE_FILES" ]]; then
    split_colon_paths "$ENV_COMPOSE_FILES"
    COMPOSE_FILES=("${SPLIT_PATHS_RESULT[@]}")
  else
    COMPOSE_FILES=("$COMPOSE_FILE")
  fi
fi

for COMPOSE_FILE_ITEM in "${COMPOSE_FILES[@]}"; do
  if [[ ! -f "$COMPOSE_FILE_ITEM" ]]; then
    echo "Error: compose file tidak ditemukan: $COMPOSE_FILE_ITEM" >&2
    exit 1
  fi
done

ENV_COMPOSE_PROFILES="${COMPOSE_PROFILES:-$(read_env_var COMPOSE_PROFILES "$ENV_FILE")}"
if [[ -n "$ENV_COMPOSE_PROFILES" ]]; then
  export COMPOSE_PROFILES="$ENV_COMPOSE_PROFILES"
fi

ENV_APP_SERVICES="${EDUSMART_APP_SERVICES:-$(read_env_var EDUSMART_APP_SERVICES "$ENV_FILE")}"
if [[ -n "$ENV_APP_SERVICES" ]]; then
  split_words "$ENV_APP_SERVICES"
  APP_SERVICES=("${SPLIT_WORDS_RESULT[@]}")
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

CURRENT_FULL_REF="$(git rev-parse HEAD)"
CURRENT_REF="$(git rev-parse --short HEAD)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups"
PRE_ROLLBACK_BACKUP="${BACKUP_DIR}/pre-rollback-${TIMESTAMP}.sql.gz"

echo "[1/7] Fetch git refs..."
git fetch --all --tags --prune
git rev-parse --verify "$TARGET_REF" >/dev/null

if detect_mosquitto_config_change "$CURRENT_FULL_REF" "$TARGET_REF"; then
  MOSQUITTO_CONFIG_CHANGED="true"
  echo "[info] Perubahan konfigurasi Mosquitto terdeteksi; broker akan direcreate setelah rollback service."
fi

if [[ "$SKIP_PRE_BACKUP" != "true" ]]; then
  echo "[2/7] Membuat backup DB sebelum rollback: $PRE_ROLLBACK_BACKUP"
  mkdir -p "$BACKUP_DIR"
  compose exec -T postgres \
    pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
    | gzip >"$PRE_ROLLBACK_BACKUP"
else
  echo "[2/7] Skip backup DB sebelum rollback (--skip-pre-backup)"
fi

echo "[3/7] Checkout target ref: $TARGET_REF"
git checkout "$TARGET_REF"
prune_missing_compose_files

if [[ -n "${EDUSMART_CADDY_IMAGE:-}" ]]; then
  IMAGE_SERVICES+=(caddy)
fi

echo "[4/7] Pull image registry & restart service produksi tanpa build lokal..."
compose pull \
  "${IMAGE_SERVICES[@]}"
compose up -d --no-build \
  "${APP_SERVICES[@]}"
recreate_mosquitto_after_config_change

if [[ -n "$RESTORE_DB_FILE" ]]; then
  echo "[5/7] Restore database dari: $RESTORE_DB_FILE"
  if [[ "$RESTORE_DB_FILE" == *.gz ]]; then
    gunzip -c "$RESTORE_DB_FILE" | compose exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$DB_USERNAME" "$DB_DATABASE"
  else
    cat "$RESTORE_DB_FILE" | compose exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$DB_USERNAME" "$DB_DATABASE"
  fi
else
  echo "[5/7] Skip restore DB (pakai schema/data yang sedang aktif)"
fi

echo "[6/7] Refresh cache aplikasi..."
compose exec -T backend php artisan optimize:clear >/dev/null

echo "[7/7] Verifikasi health API..."
curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null

echo "Rollback selesai."
echo "Current ref : $(git rev-parse --short HEAD)"
echo "Previous ref: $CURRENT_REF"
if [[ "$SKIP_PRE_BACKUP" != "true" ]]; then
  echo "DB backup   : $PRE_ROLLBACK_BACKUP"
fi
