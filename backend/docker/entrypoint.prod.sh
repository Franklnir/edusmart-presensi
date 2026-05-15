#!/usr/bin/env sh
set -eu

cd /var/www/html

if [ "${DB_CONNECTION:-}" = "pgsql" ]; then
  php -r '
    if (!extension_loaded("pdo_pgsql")) {
      fwrite(STDERR, "[entrypoint] ERROR: pdo_pgsql extension belum aktif.\n");
      exit(1);
    }
  '
fi

if [ "${WAIT_FOR_DB:-false}" = "true" ]; then
  echo "[entrypoint] waiting for database..."
  ATTEMPTS=0
  until php -r '
    $dsn = sprintf("pgsql:host=%s;port=%s;dbname=%s", getenv("DB_HOST"), getenv("DB_PORT") ?: "5432", getenv("DB_DATABASE"));
    try { new PDO($dsn, getenv("DB_USERNAME"), getenv("DB_PASSWORD")); exit(0); } catch (Throwable $e) { exit(1); }
  '; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge 30 ]; then
      echo "[entrypoint] database is not reachable after 30 attempts"
      exit 1
    fi
    sleep 2
  done
fi

if [ ! -f ".env" ]; then
  echo "[entrypoint] WARNING: .env not found inside container"
fi

mkdir -p \
  storage/framework/cache \
  storage/framework/sessions \
  storage/framework/views \
  bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache || true

if [ -n "${RFID_MOSQUITTO_PASSWORD_FILE:-}" ] || [ -n "${RFID_MOSQUITTO_ACL_FILE:-}" ]; then
  MOSQUITTO_PASSWORD_DIR="$(dirname "${RFID_MOSQUITTO_PASSWORD_FILE:-/var/www/html/mosquitto/passwords}")"
  MOSQUITTO_ACL_DIR="$(dirname "${RFID_MOSQUITTO_ACL_FILE:-/var/www/html/mosquitto/aclfile}")"
  mkdir -p "$MOSQUITTO_PASSWORD_DIR" "$MOSQUITTO_ACL_DIR" || true
  chown -R "${RFID_MOSQUITTO_FILE_UID:-82}:${RFID_MOSQUITTO_FILE_GID:-82}" "$MOSQUITTO_PASSWORD_DIR" "$MOSQUITTO_ACL_DIR" || true
  chmod 0770 "$MOSQUITTO_PASSWORD_DIR" "$MOSQUITTO_ACL_DIR" || true
fi

# Remove stale caches that may reference dev-only providers
# (e.g. laravel/pail) when container is built with --no-dev.
rm -f \
  bootstrap/cache/packages.php \
  bootstrap/cache/services.php \
  bootstrap/cache/config.php \
  bootstrap/cache/routes-*.php \
  bootstrap/cache/events.php || true

if [ "${APP_ROLE:-web}" = "web" ] && [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] running database migrations..."
  php artisan migrate --force
fi

if [ "${APP_ROLE:-web}" = "web" ] && [ -n "${SUPER_ADMIN_BOOTSTRAP_PASSWORD:-}" ]; then
  echo "[entrypoint] bootstrapping configured super admin..."
  php artisan super-admin:bootstrap --no-interaction
fi

if [ "${APP_ROLE:-web}" = "web" ] && [ "${APP_ENV:-production}" = "production" ]; then
  echo "[entrypoint] refreshing Laravel caches..."
  php artisan config:clear || true
  php artisan cache:clear || true
  if [ -d "resources/views" ]; then
    php artisan view:clear || true
  fi
  php artisan config:cache || true
  if [ -d "resources/views" ]; then
    php artisan view:cache || true
  fi
fi

exec "$@"
