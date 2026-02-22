# Integrasi Device RFID (ESP8266) - Tenant Aware

## Ringkas
- Endpoint scan RFID backend: `POST /api/rfid/scan`
- Endpoint baca mode scan: `GET /api/rfid/mode`
- Keduanya **wajib tenant** via `tenant_slug` (query/body) atau header `X-Tenant`.
- Jika `RFID_SCAN_SHARED_KEY` diisi, kirim juga header `X-RFID-Key`.
- MQTT bridge command: `php artisan rfid:mqtt-bridge`
- Topik tenant-aware default:
  - `edusmart/{tenant}/rfid/scan`
  - `edusmart/{tenant}/rfid/response`
  - `edusmart/{tenant}/rfid/mode`

## 1) Konfigurasi Backend
Set env backend:

```env
RFID_SCAN_SHARED_KEY=isi_dengan_kunci_rahasia_perangkat
RFID_MQTT_BRIDGE_ENABLED=true
RFID_MQTT_HOST=YOUR_HIVEMQ_HOST
RFID_MQTT_PORT=8883
RFID_MQTT_USERNAME=YOUR_HIVEMQ_USERNAME
RFID_MQTT_PASSWORD=YOUR_HIVEMQ_PASSWORD
RFID_MQTT_SCAN_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/scan
RFID_MQTT_RESPONSE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/response
RFID_MQTT_MODE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/mode
```

Lalu jalankan migration:

```bash
php artisan migrate
```

Migration ini akan:
- Membuat function PostgreSQL `public.absensi_rfid_auto(card_uid, device_id, tenant_id)`.
- Menjadikan UID RFID unik per tenant (`profiles_tenant_rfid_uid_unique`).

Jalankan bridge MQTT:

```bash
php artisan rfid:mqtt-bridge
```

Untuk test sekali jalan:

```bash
php artisan rfid:mqtt-bridge --once
```

## 2) Request Scan dari Device
Contoh request:

```http
POST /api/rfid/scan
Content-Type: application/json
X-RFID-Key: isi_dengan_kunci_rahasia_perangkat

{
  "tenant_slug": "sma-bali",
  "card_uid": "A1B2C3D4",
  "device_id": "WEMOS_D1_GERBANG_UTAMA"
}
```

Contoh respons sukses:

```json
{
  "success": true,
  "mode": "otomatis",
  "nama": "Budi",
  "kelas": "X-1",
  "mapel": "Matematika",
  "status": "Hadir",
  "waktu_absen": "2026-02-22T01:23:45.000000Z",
  "no_hp_wali": "62812xxxxxxx",
  "tenant_slug": "sma-bali"
}
```

Contoh respons gagal (misal di luar jadwal):

```json
{
  "success": false,
  "reason": "no_schedule_now",
  "message": "Tidak ada jadwal aktif pada jam ini",
  "tenant_slug": "sma-bali"
}
```

## 3) Cek Mode Scan dari Device
Contoh:

```http
GET /api/rfid/mode?tenant_slug=sma-bali
X-RFID-Key: isi_dengan_kunci_rahasia_perangkat
```

Respons:

```json
{
  "success": true,
  "tenant_slug": "sma-bali",
  "mode": "manual",
  "scan_manual_enabled": true,
  "rfid_aktif": true,
  "rfid_mulai": "06:30:00",
  "rfid_selesai": "15:30:00"
}
```

## 4) Catatan Tenant
- `tenant_slug` harus sesuai data tabel `tenants.slug`.
- Semua proses scan (settings/profiles/jadwal/absensi/rfid_scans) disaring per `tenant_id`.
- Satu UID kartu boleh sama antar tenant berbeda, tapi tetap unik di tenant yang sama.

## 5) Sketch ESP8266
- Gunakan sketch siap pakai di file:
  - `docs/esp8266-rfid-hivemq-tenant.ino`
- Sketch tersebut publish scan ke topik tenant-aware dan otomatis dengar response/mode dari bridge.
