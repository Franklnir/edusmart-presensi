#!/bin/sh
set -eu

# Generate a PgBouncer auth file from PostgreSQL's existing SCRAM verifier.
# The database password is never written to the repository or emitted to logs.

OUTPUT="/pgbouncer-config/userlist.txt"
CONFIG_OUTPUT="/pgbouncer-config/pgbouncer.ini"
CONFIG_SOURCE="/seed/pgbouncer.ini"

DB_USER="${DB_USERNAME:-postgres}"
DB_PASS="${DB_PASSWORD:-}"
DB_NAME="${DB_DATABASE:-postgres}"
DB_HOST="${DB_SOURCE_HOST:-postgres}"

if [ -z "$DB_PASS" ]; then
  echo "[pgbouncer-init] ERROR: DB_PASSWORD is required" >&2
  exit 1
fi

if [ ! -r "$CONFIG_SOURCE" ]; then
  echo "[pgbouncer-init] ERROR: pgbouncer.ini seed is missing" >&2
  exit 1
fi

SCRAM_VERIFIER=$(PGPASSWORD="$DB_PASS" psql \
  --host "$DB_HOST" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT rolpassword FROM pg_authid WHERE rolname = current_user")

case "$SCRAM_VERIFIER" in
  SCRAM-SHA-256\$*) ;;
  *)
    echo "[pgbouncer-init] ERROR: database role does not use a SCRAM verifier" >&2
    exit 1
    ;;
esac

ESCAPED_USER=$(printf '%s' "$DB_USER" | sed 's/\\/\\\\/g; s/"/\\"/g')
ESCAPED_VERIFIER=$(printf '%s' "$SCRAM_VERIFIER" | sed 's/\\/\\\\/g; s/"/\\"/g')

install -m 0640 "$CONFIG_SOURCE" "$CONFIG_OUTPUT"

cat > "$OUTPUT" <<EOF
"${ESCAPED_USER}" "${ESCAPED_VERIFIER}"
EOF

chmod 0640 "$OUTPUT"
chown 70:70 "$CONFIG_OUTPUT" "$OUTPUT"
echo "[pgbouncer-init] SCRAM credentials and configuration generated successfully"
