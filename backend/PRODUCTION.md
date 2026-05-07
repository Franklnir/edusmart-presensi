# Production Performance Checklist

Panduan ringkas untuk membuat Laravel lebih ringan saat banyak user login.

## 1) PHP & Web Server
- Gunakan Nginx + PHP-FPM (hindari `php artisan serve` untuk produksi).
- Aktifkan OPcache di `php.ini`:
  ```
  opcache.enable=1
  opcache.enable_cli=1
  opcache.memory_consumption=128
  opcache.interned_strings_buffer=16
  opcache.max_accelerated_files=10000
  ```
- Pastikan `memory_limit` PHP cukup (mis. 256M atau 512M).

## 2) ENV produksi (contoh)
Set di `.env`:
```
APP_ENV=production
APP_DEBUG=false
LOG_CHANNEL=stack
CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis
```

## 3) Cache & Optimizer (sekali saat deploy)
Jalankan:
```
php artisan config:cache
php artisan route:cache
php artisan view:cache
composer install --optimize-autoloader
```

## 4) Database
- Gunakan MySQL/Postgres (lebih cepat & stabil daripada SQLite untuk banyak user).
- Pastikan index sudah terpasang (migration `2026_02_01_000700_add_performance_indexes`).

## 5) Queue & Job
- Proses background gunakan queue (Redis + supervisor).
- Untuk produksi, jalankan `php artisan queue:work`.

## 6) Frontend Request
- Batasi `select *` jika tidak perlu.
- Hindari fetch berulang di setiap render.
- Gunakan pagination untuk list besar.

## 7) Monitoring
- Gunakan Laravel Telescope/Debugbar hanya di development.
- Gunakan APM (NewRelic/Sentry) untuk produksi.
