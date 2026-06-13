# Integrasi RFID MQTT-only (Laravel Sebagai Otak Sistem)

## Ringkas
- Jalur device baru: `MQTT`
- Seluruh business logic tetap diproses Laravel
- Multi-tenant ditentukan oleh `device registry` atau `tenant_slug`
- Device Arduino tidak menjalankan logic absensi, hanya publish scan dan membaca response/mode

Kontrak utama untuk device MQTT:
- `php artisan rfid:mqtt-bridge`
- `php artisan rfid:device-register`
- `php artisan rfid:device-list`
- `php artisan rfid:device-rotate-secret`

Endpoint HTTP lama (`/api/rfid/scan`, `/api/rfid/sync`, `/api/rfid/heartbeat`, `/api/rfid/mode`) masih ada untuk kompatibilitas dan operasional, tetapi template Arduino baru tidak memakainya.

Topik MQTT default:
- `edusmart/{tenant}/rfid/{device}/scan`
- `edusmart/{tenant}/rfid/{device}/response`
- `edusmart/{tenant}/rfid/{device}/mode`

## Arsitektur Final
Alur ideal yang direkomendasikan:

1. Device RFID publish scan ke MQTT.
2. `rfid:mqtt-bridge` menerima payload scan.
3. Backend menentukan tenant dari device terdaftar, topic, atau payload.
4. Laravel memproses scan, mapping kartu ke siswa/guru, menjalankan absensi, lalu menyimpan audit event.
5. Backend publish ACK/response ke topic response.
6. Device menerima ACK/response dan memberi feedback buzzer.
7. Jika MQTT belum tersambung, template baru hanya menyimpan 1 event tertunda di RAM agar tetap ringan.

Prinsip penting:
- MQTT dipakai untuk cepat dan ringan.
- Laravel tetap jadi sumber kebenaran.
- HTTP fallback tidak dipakai di template baru agar firmware lebih ringan.

## Status Project Saat Ini
Yang sudah siap di backend:
- scan tenant-aware
- mode tenant-aware
- MQTT bridge tenant-aware
- device registry (`rfid_devices`)
- event log dedupe (`rfid_device_events`)
- auth/isolasi produksi lewat broker MQTT, TLS, username/password, dan ACL topic
- endpoint HTTP legacy tetap tersedia jika nanti dibutuhkan lagi
- command operasional register/list/rotate secret

## 1) Konfigurasi Backend
Contoh env:

```env
RFID_SCAN_SHARED_KEY=
RFID_MQTT_BRIDGE_ENABLED=true
RFID_MQTT_HOST=YOUR_HIVEMQ_HOST
RFID_MQTT_PORT=8883
RFID_MQTT_USERNAME=YOUR_HIVEMQ_USERNAME
RFID_MQTT_PASSWORD=YOUR_HIVEMQ_PASSWORD
RFID_MQTT_CLIENT_ID_PREFIX=edusmart-rfid-bridge
RFID_MQTT_QOS=1
RFID_MQTT_USE_TLS=true
RFID_MQTT_TLS_VERIFY_PEER=true
RFID_MQTT_TLS_VERIFY_PEER_NAME=true
RFID_MQTT_TLS_ALLOW_SELF_SIGNED=false
RFID_MQTT_SCAN_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/{device}/scan
RFID_MQTT_RESPONSE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/{device}/response
RFID_MQTT_MODE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/{device}/mode
RFID_MQTT_DEFAULT_TENANT_SLUG=
RFID_MQTT_DEVICE_TENANT_MAP={}
RFID_MQTT_MODE_SYNC_INTERVAL=20
RFID_MQTT_RECONNECT_DELAY=5
```

Catatan:
- `RFID_SCAN_SHARED_KEY` sekarang opsional dan hanya untuk kompatibilitas device lama.
- Untuk device baru, gunakan registrasi device agar `device_id` terikat ke tenant; secret hanya untuk endpoint HTTP legacy.
- `RFID_MQTT_DEVICE_TENANT_MAP` sekarang hanya fallback legacy. Untuk produksi, lebih baik pakai `rfid_devices`.

## 2) Deploy dan Menjalankan Bridge
Jalankan service production:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build backend rfid_bridge
```

Bridge MQTT dijalankan oleh service `rfid_bridge`.

Kalau ingin jalan manual:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend \
php artisan rfid:mqtt-bridge
```

Untuk test sekali jalan:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend \
php artisan rfid:mqtt-bridge --once
```

## 3) Registrasi Device
Device harus didaftarkan dulu supaya backend bisa mengikat `device_id` ke tenant.

Contoh:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend \
php artisan rfid:device-register sman1jombang gerbang-utara-01 --name="Gerbang Utara" --transport=mqtt
```

Contoh hasil:

```txt
Device RFID berhasil didaftarkan.
Tenant     : sman1jombang
Device ID  : gerbang-utara-01
Nama       : Gerbang Utara
Transport  : mqtt
Secret     : 40-char-secret-generated
```

Untuk device MQTT-only, `--transport=mqtt` adalah default. Secret tetap bisa dibuat untuk administrasi/legacy HTTP, tetapi sketch MQTT-only tidak mengirim secret.

Lihat daftar device:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend \
php artisan rfid:device-list
```

Filter per tenant:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend \
php artisan rfid:device-list sman1jombang
```

Rotasi secret jika perangkat diganti / secret bocor:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend \
php artisan rfid:device-rotate-secret gerbang-utara-01
```

## 4) Topic MQTT Final
Topic publish scan:

```txt
edusmart/{tenant}/rfid/{device}/scan
```

Topic ACK/response:

```txt
edusmart/{tenant}/rfid/{device}/response
```

Topic mode:

```txt
edusmart/{tenant}/rfid/{device}/mode
```

Contoh nyata:

```txt
edusmart/sman1jombang/rfid/gerbang-utara-01/scan
edusmart/sman1jombang/rfid/gerbang-utara-01/response
edusmart/sman1jombang/rfid/gerbang-utara-01/mode
```

## 5) Payload MQTT Scan
Format yang direkomendasikan:

```json
{
  "event_id": "scan-20260421-081530-0001",
  "device_id": "gerbang-utara-01",
  "card_uid": "A1B2C3D4",
  "mode": "auto",
  "transport": "mqtt",
  "firmware_version": "2.0.0-mqtt-only",
  "scanned_at": "2026-04-21T08:15:30+07:00",
  "tenant_slug": "sman1jombang"
}
```

Keterangan:
- `event_id`: wajib unik per device untuk dedupe/retry
- `device_id`: wajib
- `card_uid`: wajib, 8-32 karakter heksadesimal
- `mode`: opsional, nilai umum `auto`, `manual`, atau `enroll`
- `scanned_at`: opsional, tapi sebaiknya selalu dikirim
- `tenant_slug`: opsional jika device sudah terdaftar, tetap aman dikirim untuk observability

## 6) Payload Response / ACK MQTT
Contoh sukses:

```json
{
  "success": true,
  "event_id": "scan-20260421-081530-0001",
  "device_id": "gerbang-utara-01",
  "card_uid": "A1B2C3D4",
  "status": "Hadir",
  "nama": "Budi Santoso",
  "kelas": "X A MIPA",
  "tenant_slug": "sman1jombang",
  "source": "rfid-mqtt-bridge",
  "received_topic": "edusmart/sman1jombang/rfid/gerbang-utara-01/scan",
  "http_status": 200
}
```

Contoh enroll sukses:

```json
{
  "success": true,
  "event_id": "scan-20260421-081530-0001",
  "device_id": "gerbang-utara-01",
  "reason": "enroll_success",
  "message": "UID terdeteksi (Mode Enroll)",
  "card_uid": "A1B2C3D4",
  "scan_id": 123,
  "tenant_slug": "sman1jombang",
  "source": "rfid-mqtt-bridge",
  "http_status": 200
}
```

Contoh duplicate event:

```json
{
  "success": true,
  "duplicate": true,
  "reason": "duplicate_event",
  "message": "Event RFID sudah pernah diproses",
  "event_id": "scan-20260421-081530-0001",
  "device_id": "gerbang-utara-01",
  "tenant_slug": "sman1jombang",
  "source": "rfid-mqtt-bridge",
  "http_status": 200
}
```

Contoh gagal:

```json
{
  "success": false,
  "reason": "invalid_card_uid",
  "message": "Format card_uid tidak valid (8-32 karakter heksadesimal)",
  "event_id": "scan-20260421-081530-0001",
  "device_id": "gerbang-utara-01",
  "card_uid": "A1B2C3D4",
  "tenant_slug": "sman1jombang",
  "source": "rfid-mqtt-bridge",
  "http_status": 422
}
```

## 7) Topic Mode
Payload mode saat ini dipublish sebagai string sederhana:

```txt
auto
```

atau:

```txt
manual
```

atau:

```txt
enroll
```

Rekomendasi di device:
- subscribe ke topic mode saat boot
- cache mode terakhir
- saat reconnect, tunggu retained message mode dari backend

Catatan ACK:
- karena topic response sudah per-device, firmware cukup memfilter ACK berdasarkan `event_id`
- backend mengembalikan `device_id`, `event_id`, dan `card_uid` pada response MQTT agar device tahu scan mana yang sudah selesai

## 8) Endpoint HTTP Legacy
Endpoint HTTP masih tersedia untuk kompatibilitas alat lama dan debugging:
- `POST /api/rfid/scan`
- `POST /api/rfid/sync`
- `POST /api/rfid/heartbeat`
- `GET /api/rfid/mode`

Template Arduino MQTT-only tidak memakai endpoint ini. Untuk device baru, jalur yang dipakai cukup topic `scan`, `response`, dan `mode`.

## 9) Strategi Retry di Device MQTT-only
Supaya firmware tetap ringan:

1. Saat kartu di-scan, device membuat `event_id` unik.
2. Device publish payload ke topic scan.
3. Device menunggu response dengan `event_id` yang sama.
4. Jika ACK belum datang, device retry publish beberapa kali dengan `event_id` yang sama.
5. Jika tetap gagal, event dibatalkan dan operator bisa scan ulang.

Aturan aman:
- jangan generate `event_id` baru saat retry
- filter response berdasarkan `event_id`
- satu event tertunda di RAM sudah cukup untuk reader gerbang/kelas yang ringan

## 10) Enroll vs Absensi Normal
### Mode `enroll`
- dipakai saat admin sedang mendaftarkan UID kartu
- backend hanya menyimpan deteksi UID
- hasil biasanya `reason = enroll_success`

### Mode `auto`
- dipakai untuk absensi normal ketika scan manual masuk/pulang tidak aktif
- backend jalankan function `absensi_rfid_auto`
- backend hanya mencatat hadir jika ada jadwal pelajaran aktif
- jika tidak ada jadwal berjalan, response akan ditolak dengan `reason = no_schedule_now`

### Mode `manual`
- muncul saat fitur scan masuk/pulang aktif di pengaturan
- backend memilih sesi `masuk` atau `pulang` berdasarkan rentang jam manual
- jika di luar jam masuk/pulang, response akan ditolak dengan `reason = no_manual_window`

## 11) Urutan Resolusi Tenant
Saat backend menerima event, tenant ditentukan dengan urutan:

1. `device_id` yang terdaftar di `rfid_devices`
2. tenant dari topic MQTT
3. `tenant_slug` di payload
4. `RFID_MQTT_DEVICE_TENANT_MAP` legacy fallback
5. `RFID_MQTT_DEFAULT_TENANT_SLUG`

Rekomendasi produksi:
- utamakan `rfid_devices`
- gunakan topic tenant-aware
- jangan bergantung ke env static map untuk jangka panjang

## 12) Checklist Siap Jalan
Sebelum integrasi device dimulai, pastikan:

- broker MQTT aktif dan bisa diakses dari VPS
- `rfid_bridge` dalam status up
- device sudah didaftarkan dengan `rfid:device-register`
- kelas/siswa/guru/kartu RFID di tenant sudah benar
- topic publish/subscribe device sesuai template
- device memakai `event_id` unik
- ACL broker membatasi device hanya ke topic yang benar

## 13) Keamanan
- untuk MQTT, keamanan utama ada di broker: TLS, username/password, ACL topic
- secret device tetap bisa dirotasi untuk kebutuhan operasional/legacy HTTP
- jangan pakai satu username/password broker untuk semua tenant tanpa ACL topic

## 14) Catatan Arduino/ESP8266/ESP32
Project backend ini sudah siap untuk dipasangkan ke sketch device.

Sketch ESP8266/Arduino yang siap dipakai sebagai baseline sudah disediakan. Panel super admin bisa menghasilkan versi ESP8266 atau ESP32 berdasarkan `board_type` alat yang tersimpan. Yang perlu kamu sesuaikan tinggal:
- koneksi TLS ke broker
- topik publish dan subscribe
- format payload di atas
- retry MQTT ringan untuk 1 event tertunda
- baca mode dari topic retained

File sketch MQTT-only yang siap dipakai ada di:
- `docs/esp8266-rfid-mosquitto-tenant.ino`
