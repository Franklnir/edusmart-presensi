#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${EDUSMART_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BACKUP_RETENTION_DAYS="${EDUSMART_BACKUP_RETENTION_DAYS:-14}"
IMAGE_PRUNE_UNTIL="${EDUSMART_IMAGE_PRUNE_UNTIL:-168h}"
BUILDER_PRUNE_UNTIL="${EDUSMART_BUILDER_PRUNE_UNTIL:-24h}"
JOURNAL_VACUUM_TIME="${EDUSMART_JOURNAL_VACUUM_TIME:-7d}"
MIN_FREE_MB="${EDUSMART_MIN_FREE_DISK_MB:-2048}"
FAIL_ON_LOW_FREE="${EDUSMART_DISK_FAIL_ON_LOW_FREE:-false}"

disk_free_mb() {
  df -Pm / | awk 'NR == 2 { print $4 }'
}

print_disk_status() {
  echo "[disk] Filesystem root:"
  df -h /
  echo
  if command -v docker >/dev/null 2>&1; then
    echo "[disk] Docker usage:"
    docker system df || true
    echo
  fi
}

echo "[disk] Status sebelum maintenance"
print_disk_status

if command -v docker >/dev/null 2>&1; then
  echo "[disk] Prune stopped containers dan network tidak terpakai..."
  docker container prune -f || true
  docker network prune -f || true

  echo "[disk] Prune build cache lebih lama dari ${BUILDER_PRUNE_UNTIL}..."
  docker builder prune -af --filter "until=${BUILDER_PRUNE_UNTIL}" || true

  echo "[disk] Prune image tidak terpakai lebih lama dari ${IMAGE_PRUNE_UNTIL}..."
  docker image prune -af --filter "until=${IMAGE_PRUNE_UNTIL}" || true
fi

if [[ -d "${ROOT_DIR}/backups" ]]; then
  echo "[disk] Hapus backup pre-release lebih lama dari ${BACKUP_RETENTION_DAYS} hari..."
  find "${ROOT_DIR}/backups" -type f -name 'pre-release-*.sql.gz' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete || true
fi

if command -v journalctl >/dev/null 2>&1; then
  echo "[disk] Vacuum systemd journal lebih lama dari ${JOURNAL_VACUUM_TIME}..."
  journalctl --vacuum-time="${JOURNAL_VACUUM_TIME}" || true
fi

echo
echo "[disk] Status setelah maintenance"
print_disk_status

FREE_MB="$(disk_free_mb)"
if [[ "${FREE_MB}" =~ ^[0-9]+$ ]] && (( FREE_MB < MIN_FREE_MB )); then
  echo "[disk] WARNING: free disk ${FREE_MB}MB < target ${MIN_FREE_MB}MB." >&2
  echo "[disk] Tambah storage VPS atau pindahkan backup/log besar sebelum rilis penuh." >&2
  if [[ "${FAIL_ON_LOW_FREE}" == "true" ]]; then
    exit 2
  fi
fi
