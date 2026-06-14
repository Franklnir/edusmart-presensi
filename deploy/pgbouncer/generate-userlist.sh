#!/bin/sh
set -eu

# Generate pgbouncer userlist.txt from environment variables.
# Format: "username" "md5(password+username)"
# This runs as an init step before pgbouncer starts.

OUTPUT="/etc/pgbouncer/userlist.txt"

DB_USER="${DB_USERNAME:-edusmart}"
DB_PASS="${DB_PASSWORD:-}"

if [ -z "$DB_PASS" ]; then
  echo "[pgbouncer-init] ERROR: DB_PASSWORD is required" >&2
  exit 1
fi

# PgBouncer md5 auth: md5(password + username)
MD5_HASH=$(printf '%s' "${DB_PASS}${DB_USER}" | md5sum | awk '{print $1}')

cat > "$OUTPUT" <<EOF
"${DB_USER}" "md5${MD5_HASH}"
EOF

# Add evolution DB user if configured
if [ -n "${EVOLUTION_DB_USER:-}" ] && [ -n "${EVOLUTION_DB_PASSWORD:-}" ]; then
  EVO_MD5=$(printf '%s' "${EVOLUTION_DB_PASSWORD}${EVOLUTION_DB_USER}" | md5sum | awk '{print $1}')
  echo "\"${EVOLUTION_DB_USER}\" \"md5${EVO_MD5}\"" >> "$OUTPUT"
fi

chmod 0640 "$OUTPUT"
echo "[pgbouncer-init] userlist.txt generated successfully"
