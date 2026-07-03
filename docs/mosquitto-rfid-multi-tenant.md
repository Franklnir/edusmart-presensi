# Mosquitto RFID Multi-Tenant

EduSmart dapat menjalankan broker Mosquitto sendiri untuk RFID MQTT-only.
Arsitektur default production:

- `mosquitto:1883` hanya untuk jaringan internal Docker dan dipakai backend bridge.
- `${RFID_MOSQUITTO_PUBLIC_PORT:-8883}` diekspos untuk ESP dengan TLS.
- Setiap sekolah punya username/password MQTT sendiri.
- Backend bridge punya username/password sendiri.
- ACL Mosquitto membatasi tenant:
  - device sekolah hanya boleh `write` ke topic scan sekolahnya;
  - device sekolah hanya boleh `read` topic response dan mode sekolahnya;
  - bridge backend hanya boleh `read` scan dan `write` response/mode tenant yang terdaftar.

## Environment Wajib

Isi di `.env.production`:

```env
RFID_MOSQUITTO_ENABLED=true
RFID_MOSQUITTO_PUBLIC_HOST=mqtt.sismu.biz.id
RFID_MOSQUITTO_PUBLIC_PORT=8883
RFID_MOSQUITTO_PUBLIC_USE_TLS=true
RFID_MOSQUITTO_INTERNAL_HOST=mosquitto
RFID_MOSQUITTO_INTERNAL_PORT=1883
RFID_MOSQUITTO_INTERNAL_USE_TLS=false
RFID_MOSQUITTO_BRIDGE_USERNAME=edusmart_bridge
RFID_MOSQUITTO_BRIDGE_PASSWORD=GANTI_PASSWORD_PANJANG_RANDOM
RFID_MOSQUITTO_TOPIC_PREFIX=edusmart
RFID_MOSQUITTO_STRICT_DEVICE_ACL=true
MOSQUITTO_CERT_SYNC_INTERVAL_SECONDS=300
```

Untuk DNS, arahkan `mqtt.sismu.biz.id` ke server yang menjalankan
`docker-compose.prod.yml`. Port public default adalah `8883`.

## Deploy

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build mosquitto_init mosquitto mosquitto_reloader mosquitto_cert_sync backend rfid_bridge caddy
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan migrate --force
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan rfid:mosquitto-sync
docker compose --env-file .env.production -f docker-compose.prod.yml restart rfid_bridge
```

`mosquitto_init` akan membuat self-signed certificate pertama kali di
`deploy/mosquitto/generated/certs` sebagai fallback awal. Di production,
`caddy` menerbitkan sertifikat public CA untuk `RFID_MOSQUITTO_PUBLIC_HOST`,
lalu `mosquitto_cert_sync` menyalin sertifikat tersebut ke
`deploy/mosquitto/generated/certs/server.crt` dan `server.key`. Service
`mosquitto_reloader` akan me-reload broker ketika file sertifikat berubah.

## Provision Sekolah

Dari halaman Super Admin > Detail Sekolah > Konfigurasi MQTT RFID Sekolah:

1. Klik `Pakai Mosquitto`.
2. Backend membuat username/password tenant.
3. Backend menulis ulang `passwords` dan `aclfile`.
4. `mosquitto_reloader` me-reload broker dalam sekitar 10 detik.
5. Template Arduino otomatis berisi host, port, credential, dan topic sekolah.

Kalau password tenant bocor, klik `Rotasi Password`, lalu flash ulang device
dengan template terbaru. Pastikan `device_id` alat memakai format aman tanpa
spasi, misalnya `gerbang-2`; nilai ini menjadi bagian dari ACL/topic MQTT.

## ACL Ketat Per Device

Default production memakai `RFID_MOSQUITTO_STRICT_DEVICE_ACL=true`. File ACL
Mosquitto tidak lagi memberi akses wildcard ke semua device tenant, tetapi
hanya topic milik device aktif yang sudah tercatat di `rfid_devices`.

Setiap kali device ditambah atau dihapus dari Super Admin, backend melakukan
sync ulang `aclfile` best-effort dan `mosquitto_reloader` akan reload broker.
Jika harus melakukan recovery perangkat lama yang belum terdaftar, set
`RFID_MOSQUITTO_STRICT_DEVICE_ACL=false` sementara, daftarkan device, jalankan
`php artisan rfid:mosquitto-sync`, lalu aktifkan kembali.
