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
```

Untuk DNS, arahkan `mqtt.sismu.biz.id` ke server yang menjalankan
`docker-compose.prod.yml`. Port public default adalah `8883`.

## Deploy

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build mosquitto_init mosquitto mosquitto_reloader backend rfid_bridge
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan migrate --force
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan rfid:mosquitto-sync
docker compose --env-file .env.production -f docker-compose.prod.yml restart rfid_bridge
```

`mosquitto_init` akan membuat self-signed certificate pertama kali di
`deploy/mosquitto/generated/certs`. Sketch ESP memakai TLS dengan mode insecure
verification, sehingga koneksi tetap terenkripsi. Untuk keamanan paling kuat,
ganti certificate tersebut dengan certificate public CA untuk host MQTT.

## Provision Sekolah

Dari halaman Super Admin > Detail Sekolah > Konfigurasi MQTT RFID Sekolah:

1. Klik `Pakai Mosquitto`.
2. Backend membuat username/password tenant.
3. Backend menulis ulang `passwords` dan `aclfile`.
4. `mosquitto_reloader` me-reload broker dalam sekitar 10 detik.
5. Template Arduino otomatis berisi host, port, credential, dan topic sekolah.

Kalau password tenant bocor, klik `Rotasi Password`, lalu flash ulang device
dengan template terbaru.
