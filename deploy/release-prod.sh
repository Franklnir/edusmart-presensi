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
APP_SERVICES=(backend worker scheduler rfid_bridge nginx caddy mosquitto_cert_sync)
IMAGE_SERVICES=(backend nginx)
CORE_HEALTH_SERVICES=(postgres redis backend worker scheduler nginx caddy)
OPTIONAL_APP_SERVICES=()
OPTIONAL_HEALTH_SERVICES=()
COMPOSE_FILES=()
PREV_FULL_REF=""
PREV_REF=""
PREV_BACKEND_IMAGE=""
PREV_NGINX_IMAGE=""
PREV_CADDY_IMAGE=""
DEPLOY_PHASE="preflight"
ROLLBACK_RUNNING="false"

usage() {
  cat <<'USAGE'
Usage:
  deploy/release-prod.sh --ref <git_ref> [options]

Options:
  --ref <git_ref>         Ref release (tag/branch/commit). Wajib.
  --env-file <path>       Path env file (default: .env.production)
  --compose-file <path>   Path docker compose file. Bisa diulang untuk override.
  --skip-backup           Lewati backup DB sebelum release
  --skip-build            Legacy alias; build lokal production sudah dinonaktifkan
  --pull-images           Pull image dari registry sebelum deploy (default)
  --no-pull-images        Jangan pull registry; pakai image lokal yang sudah ada, tetap tanpa build
  --no-auto-rollback      Jangan rollback otomatis bila deploy/health check gagal
  --external-smoke-check  Jalankan deploy/scripts/prod_smoke_check.sh setelah health check internal
  -h, --help              Tampilkan bantuan

Contoh:
  EDUSMART_BACKEND_IMAGE=ghcr.io/org/repo/backend:sha EDUSMART_NGINX_IMAGE=ghcr.io/org/repo/nginx:sha EDUSMART_CADDY_IMAGE=ghcr.io/org/repo/caddy:sha deploy/release-prod.sh --ref v1.5.0
  EDUSMART_BACKEND_IMAGE=ghcr.io/org/repo/backend:sha EDUSMART_NGINX_IMAGE=ghcr.io/org/repo/nginx:sha EDUSMART_CADDY_IMAGE=ghcr.io/org/repo/caddy:sha deploy/release-prod.sh --ref main --pull-images
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

protect_runtime_generated_files() {
  git update-index --skip-worktree -- \
    deploy/mosquitto/generated/.gitignore \
    deploy/mosquitto/generated/.gitkeep 2>/dev/null || true
}

append_unique() {
  local array_name="$1"
  shift

  local -n target_array="$array_name"
  local item
  local existing
  local found

  for item in "$@"; do
    found="false"
    for existing in "${target_array[@]}"; do
      if [[ "$existing" == "$item" ]]; then
        found="true"
        break
      fi
    done

    if [[ "$found" != "true" ]]; then
      target_array+=("$item")
    fi
  done
}

remove_items() {
  local array_name="$1"
  shift

  local -n target_array="$array_name"
  local kept=()
  local item
  local remove
  local should_remove

  for item in "${target_array[@]}"; do
    should_remove="false"
    for remove in "$@"; do
      if [[ "$item" == "$remove" ]]; then
        should_remove="true"
        break
      fi
    done

    if [[ "$should_remove" != "true" ]]; then
      kept+=("$item")
    fi
  done

  target_array=("${kept[@]}")
}

configure_optional_evolution_services() {
  local required_vars=(
    EVOLUTION_API_KEY
    EVOLUTION_PUBLIC_URL
    EVOLUTION_DB_PASSWORD
    EVOLUTION_REDIS_PASSWORD
    EVOLUTION_CORS_ORIGIN
    CADDY_EVOLUTION_HOST
  )
  local missing=()
  local name

  for name in "${required_vars[@]}"; do
    if [[ -z "$(read_env_var "$name" "$ENV_FILE")" ]]; then
      missing+=("$name")
    fi
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "[info] Evolution API tidak diaktifkan otomatis; env belum lengkap: ${missing[*]}"
    return 0
  fi

  remove_items IMAGE_SERVICES evolution_api evolution_postgres evolution_redis
  remove_items APP_SERVICES evolution_postgres evolution_redis evolution_api
  remove_items CORE_HEALTH_SERVICES evolution_postgres evolution_redis evolution_api
  append_unique OPTIONAL_APP_SERVICES evolution_postgres evolution_redis evolution_api
  append_unique OPTIONAL_HEALTH_SERVICES evolution_postgres evolution_redis evolution_api
  echo "[info] Evolution API aktif: service evolution_postgres/evolution_redis/evolution_api akan ikut dideploy."
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

validate_compose_files_available() {
  local file

  for file in "${COMPOSE_FILES[@]}"; do
    if [[ -f "$file" ]]; then
      continue
    fi

    if [[ "$file" != /* ]] && git cat-file -e "$TARGET_REF:$file" 2>/dev/null; then
      continue
    fi

    echo "Error: compose file tidak ditemukan: $file" >&2
    exit 1
  done
}

validate_compose_files_present() {
  local file

  for file in "${COMPOSE_FILES[@]}"; do
    if [[ ! -f "$file" ]]; then
      echo "Error: compose file tidak ditemukan setelah checkout: $file" >&2
      exit 1
    fi
  done
}

prune_missing_compose_files() {
  local existing=()
  local file

  for file in "${COMPOSE_FILES[@]}"; do
    if [[ -f "$file" ]]; then
      existing+=("$file")
    else
      echo "[rollback] compose file $file tidak ada di ref lama, dilewati." >&2
    fi
  done

  if [[ "${#existing[@]}" -eq 0 ]]; then
    echo "[rollback] tidak ada compose file yang tersedia untuk rollback." >&2
    return 1
  fi

  COMPOSE_FILES=("${existing[@]}")
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

compose_service_state() {
  local service="$1"
  local container_id
  container_id="$(compose ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    printf '%s\n' ""
    return 0
  fi

  docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true
}

git_status_for_release() {
  git status --porcelain -- . \
    ':!deploy/mosquitto/generated' \
    ':!backups' \
    ':!.env.production'
}

stash_release_blocking_changes() {
  local changes
  local stash_ref
  local timestamp
  local paths=()
  local line
  local path

  changes="$(git_status_for_release)"
  if [[ -z "$changes" ]]; then
    return 0
  fi

  timestamp="$(date +%Y%m%d-%H%M%S)"
  stash_ref="pre-release-local-changes-${timestamp}"

  echo "[info] Ada perubahan lokal di VPS yang bisa menghalangi release; disimpan ke git stash: ${stash_ref}"
  printf '%s\n' "$changes"

  while IFS= read -r line; do
    path="${line:3}"
    if [[ "$path" == *" -> "* ]]; then
      path="${path##* -> }"
    fi
    [[ -n "$path" ]] && paths+=("$path")
  done <<< "$changes"

  if [[ "${#paths[@]}" -eq 0 ]]; then
    echo "[warn] Tidak ada path aman untuk distash; lanjutkan validasi working tree."
    return 0
  fi

  git stash push --include-untracked --message "$stash_ref" -- "${paths[@]}" >/dev/null

  echo "[info] File env, backup, generated Mosquitto, dan file ignored lain tetap dipertahankan."
}

check_compose_service() {
  local service="$1"
  local container_id
  local state
  local start_ts
  local now_ts
  local timeout
  local last_state

  timeout="${2:-${DEPLOY_HEALTH_WAIT_SECONDS:-180}}"
  start_ts="$(date +%s)"
  last_state=""

  while true; do
    container_id="$(compose ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      state="$(docker inspect --format '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    else
      state="missing"
    fi

    case "$state" in
      running|running/healthy)
        echo "[ok] service $service: $state"
        return 0
        ;;
    esac

    if [[ "$state" != "$last_state" ]]; then
      echo "[wait] service $service: $state"
      last_state="$state"
    fi

    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= timeout )); then
      echo "[fail] service $service tidak sehat setelah ${timeout}s: $state" >&2
      return 1
    fi

    sleep 5
  done
}

run_optional_health_checks() {
  local timeout
  local service

  if [[ "${#OPTIONAL_HEALTH_SERVICES[@]}" -eq 0 ]]; then
    return 0
  fi

  timeout="${DEPLOY_OPTIONAL_HEALTH_WAIT_SECONDS:-45}"
  echo "      - cek service opsional"
  for service in "${OPTIONAL_HEALTH_SERVICES[@]}"; do
    if check_compose_service "$service" "$timeout"; then
      continue
    fi

    echo "[warn] service opsional $service belum sehat setelah ${timeout}s." >&2
    echo "[warn] Aplikasi utama tetap lanjut; cek log $service untuk memastikan gateway WhatsApp siap." >&2
    compose ps "$service" >&2 || true
    compose logs --tail="${DEPLOY_OPTIONAL_LOG_TAIL:-80}" "$service" >&2 || true
  done
}

start_optional_services() {
  if [[ "${#OPTIONAL_APP_SERVICES[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "      - deploy service opsional"
  if compose up -d --no-build "${OPTIONAL_APP_SERVICES[@]}"; then
    if [[ " ${APP_SERVICES[*]} " == *" caddy "* ]]; then
      echo "      - refresh proxy publik setelah service opsional"
      compose restart caddy >/dev/null || true
    fi

    return 0
  fi

  echo "[warn] service opsional gagal start. Aplikasi utama tetap lanjut." >&2
  echo "[warn] Cek konfigurasi/image service opsional berikut: ${OPTIONAL_APP_SERVICES[*]}" >&2
  compose ps "${OPTIONAL_APP_SERVICES[@]}" >&2 || true
  compose logs --tail="${DEPLOY_OPTIONAL_LOG_TAIL:-80}" "${OPTIONAL_APP_SERVICES[@]}" >&2 || true
}

run_internal_health_checks() {
  local response
  local start_ts
  local now_ts
  local timeout

  echo "      - cek container inti"
  for service in "${CORE_HEALTH_SERVICES[@]}"; do
    check_compose_service "$service"
  done

  echo "      - cek endpoint API lokal"
  timeout="${DEPLOY_HEALTH_WAIT_SECONDS:-180}"
  start_ts="$(date +%s)"
  response=""
  until response="$(compose exec -T nginx wget -q -O - "http://127.0.0.1/api/health" 2>/dev/null)" \
    && printf '%s' "$response" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; do
    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= timeout )); then
      echo "[fail] /api/health belum valid setelah ${timeout}s: ${response:-no response}" >&2
      return 1
    fi
    sleep 5
  done
  echo "[ok] /api/health status ok"

  echo "      - cek koneksi Laravel ke database"
  compose exec -T backend php artisan migrate:status --no-interaction >/dev/null
  echo "[ok] Laravel migrate:status sukses"

  run_optional_health_checks
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

  prune_missing_compose_files || {
    set -e
    return 1
  }

  if [[ -n "$PREV_BACKEND_IMAGE" ]]; then
    export EDUSMART_BACKEND_IMAGE="$PREV_BACKEND_IMAGE"
  fi
  if [[ -n "$PREV_NGINX_IMAGE" ]]; then
    export EDUSMART_NGINX_IMAGE="$PREV_NGINX_IMAGE"
  fi
  if [[ -n "$PREV_CADDY_IMAGE" ]]; then
    export EDUSMART_CADDY_IMAGE="$PREV_CADDY_IMAGE"
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
      COMPOSE_FILES+=("${2:-}")
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

if [[ "${#COMPOSE_FILES[@]}" -eq 0 ]]; then
  ENV_COMPOSE_FILES="${EDUSMART_COMPOSE_FILES:-$(read_env_var EDUSMART_COMPOSE_FILES "$ENV_FILE")}"
  if [[ -n "$ENV_COMPOSE_FILES" ]]; then
    split_colon_paths "$ENV_COMPOSE_FILES"
    COMPOSE_FILES=("${SPLIT_PATHS_RESULT[@]}")
  else
    COMPOSE_FILES=("$COMPOSE_FILE")
    ENV_USE_4GB_PROFILE="${EDUSMART_USE_4GB_PROFILE:-$(read_env_var EDUSMART_USE_4GB_PROFILE "$ENV_FILE")}"
    if [[ "$ENV_USE_4GB_PROFILE" =~ ^(1|true|TRUE|yes|YES|on|ON)$ ]] \
      && { [[ -f "docker-compose.prod.4gb.yml" ]] || git cat-file -e "$TARGET_REF:docker-compose.prod.4gb.yml" 2>/dev/null; }; then
      COMPOSE_FILES+=("docker-compose.prod.4gb.yml")
    fi
  fi
fi

ENV_COMPOSE_PROFILES="${COMPOSE_PROFILES:-$(read_env_var COMPOSE_PROFILES "$ENV_FILE")}"
if [[ -n "$ENV_COMPOSE_PROFILES" ]]; then
  export COMPOSE_PROFILES="$ENV_COMPOSE_PROFILES"
fi

ENV_APP_SERVICES="${EDUSMART_APP_SERVICES:-$(read_env_var EDUSMART_APP_SERVICES "$ENV_FILE")}"
if [[ -n "$ENV_APP_SERVICES" ]]; then
  split_words "$ENV_APP_SERVICES"
  APP_SERVICES=("${SPLIT_WORDS_RESULT[@]}")
fi

ENV_CORE_HEALTH_SERVICES="${EDUSMART_CORE_HEALTH_SERVICES:-$(read_env_var EDUSMART_CORE_HEALTH_SERVICES "$ENV_FILE")}"
if [[ -n "$ENV_CORE_HEALTH_SERVICES" ]]; then
  split_words "$ENV_CORE_HEALTH_SERVICES"
  CORE_HEALTH_SERVICES=("${SPLIT_WORDS_RESULT[@]}")
fi

configure_optional_evolution_services
protect_runtime_generated_files
stash_release_blocking_changes

WORKTREE_CHANGES="$(git_status_for_release)"
if [[ -n "$WORKTREE_CHANGES" ]]; then
  echo "Error: working tree tidak bersih. Commit/stash dulu sebelum release." >&2
  printf '%s\n' "$WORKTREE_CHANGES" >&2
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
validate_compose_files_available

PREV_FULL_REF="$(git rev-parse HEAD)"
PREV_REF="$(git rev-parse --short HEAD)"

echo "[2/9] Checkout release ref: $TARGET_REF"
git checkout "$TARGET_REF"
validate_compose_files_present

PREV_BACKEND_IMAGE="$(compose_service_image backend)"
PREV_NGINX_IMAGE="$(compose_service_image nginx)"
PREV_CADDY_IMAGE="$(compose_service_image caddy)"

if [[ -n "${EDUSMART_CADDY_IMAGE:-}" ]]; then
  append_unique IMAGE_SERVICES caddy
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups"
RELEASE_BACKUP="${BACKUP_DIR}/pre-release-${TIMESTAMP}.sql.gz"

if [[ "$SKIP_BACKUP" != "true" ]]; then
  POSTGRES_STATE="$(compose_service_state postgres)"
  if [[ -z "$POSTGRES_STATE" ]]; then
    echo "[3/9] Skip backup DB: service postgres belum ada di VPS ini (first deploy)."
  elif [[ "$POSTGRES_STATE" != "running" ]]; then
    echo "Error: service postgres ada tapi statusnya '$POSTGRES_STATE'. Backup DB dibatalkan agar deploy tidak lanjut tanpa backup." >&2
    echo "       Perbaiki postgres lebih dulu atau jalankan manual dengan --skip-backup jika ini benar-benar initial deploy." >&2
    exit 1
  else
    echo "[3/9] Backup DB sebelum deploy: $RELEASE_BACKUP"
    mkdir -p "$BACKUP_DIR"
    compose exec -T postgres \
      pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
      | gzip >"$RELEASE_BACKUP"
  fi
else
  echo "[3/9] Skip backup DB (--skip-backup)"
fi

DEPLOY_PHASE="pull_images"
if [[ "$PULL_IMAGES" == "true" ]]; then
  echo "[4/9] Bersihkan image/cache Docker tidak terpakai sebelum pull..."
  docker system prune -af || true
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
start_optional_services

DEPLOY_PHASE="migrate"
echo "[6/9] Jalankan migrasi..."
compose exec -T backend php artisan migrate --force

DEPLOY_PHASE="clear_cache"
echo "[7/9] Clear optimize cache..."
compose exec -T backend php artisan optimize:clear >/dev/null

echo "[7/9] Sync inventory Neva S3 best-effort..."
if ! compose exec -T backend php artisan storage:sync-object-storage --max-pages="${DEPLOY_OBJECT_STORAGE_SYNC_MAX_PAGES:-10}"; then
  echo "[warn] Sync inventory Neva S3 dilewati/gagal. Deploy tetap lanjut; scheduler akan mencoba lagi berkala." >&2
fi

DEPLOY_PHASE="health_check"
echo "[8/9] Health check internal..."
run_internal_health_checks

if [[ "$RUN_EXTERNAL_SMOKE_CHECK" == "true" ]]; then
  DEPLOY_PHASE="external_smoke_check"
  echo "[8/9] Smoke check eksternal..."
  SMOKE_ENV_FILE="$ENV_FILE"
  if [[ "$SMOKE_ENV_FILE" != /* ]]; then
    SMOKE_ENV_FILE="$ROOT_DIR/$SMOKE_ENV_FILE"
  fi
  ENV_FILE="$SMOKE_ENV_FILE" EDUSMART_COMPOSE_FILES="$(IFS=:; echo "${COMPOSE_FILES[*]}")" "$ROOT_DIR/deploy/scripts/prod_smoke_check.sh"
fi

DEPLOY_PHASE="done"
echo "[9/9] Selesai."
echo "Release aktif : $(git rev-parse --short HEAD)"
echo "Release lama  : $PREV_REF"
if [[ "$SKIP_BACKUP" != "true" ]]; then
  echo "Backup DB     : $RELEASE_BACKUP"
fi
echo "Rollback cepat: EDUSMART_BACKEND_IMAGE=${PREV_BACKEND_IMAGE:-<image-lama>} EDUSMART_NGINX_IMAGE=${PREV_NGINX_IMAGE:-<image-lama>} EDUSMART_CADDY_IMAGE=${PREV_CADDY_IMAGE:-<image-lama>} deploy/rollback-prod.sh --ref $PREV_REF"
