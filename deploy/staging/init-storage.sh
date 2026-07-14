#!/bin/sh

set -eu

: "${STAGING_STORAGE_ACCESS_KEY:?required}"
: "${STAGING_STORAGE_SECRET_KEY:?required}"
: "${STAGING_STORAGE_BUCKET:?required}"
: "${STAGING_FRONTEND_ORIGIN:?required}"

case "$STAGING_FRONTEND_ORIGIN" in
  https://sismu.biz.id|https://origin.sismu.biz.id)
    echo "[storage-init] production origin is forbidden" >&2
    exit 1
    ;;
esac

mc alias set staging http://minio:9000 "$STAGING_STORAGE_ACCESS_KEY" "$STAGING_STORAGE_SECRET_KEY" >/dev/null
mc mb --ignore-existing "staging/$STAGING_STORAGE_BUCKET" >/dev/null

cat >/tmp/cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["$STAGING_FRONTEND_ORIGIN"],
      "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["content-type", "x-amz-checksum-sha256", "x-amz-date", "authorization", "x-amz-content-sha256", "x-amz-security-token"],
      "ExposeHeaders": ["ETag", "x-amz-checksum-sha256"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

mc cors set "staging/$STAGING_STORAGE_BUCKET" /tmp/cors.json
mc anonymous set none "staging/$STAGING_STORAGE_BUCKET" >/dev/null

retention_days="${STAGING_STORAGE_RETENTION_DAYS:-14}"
case "$retention_days" in
  ''|*[!0-9]*) echo "[storage-init] invalid retention days" >&2; exit 1 ;;
esac
mc ilm rule add --expire-days "$retention_days" "staging/$STAGING_STORAGE_BUCKET" >/dev/null

echo "[storage-init] isolated bucket, private access, CORS, and lifecycle configured"
