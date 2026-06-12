# Security Hardening Sismu

Dokumen ini adalah tindak lanjut laporan keamanan untuk production `sismu.biz.id`.
Perubahan kode di repo menutup endpoint API yang berisiko, menambah hardening header,
dan membersihkan referensi domain lama. Bagian VPS/DNS di bawah tetap harus disetel di
server karena bergantung pada IP admin, IP perangkat RFID, dan panel DNS.

## Yang Sudah Diperbaiki Di Repo

- `GET /api/auth/me` sekarang wajib autentikasi dan mengembalikan `401` jika token/session tidak valid.
- `POST /api/db` dan `POST /api/db/batch` sekarang wajib `auth:sanctum`.
- Branding login/register memakai `GET /api/public/settings`, wrapper publik kecil dengan allowlist field aman dari tabel `settings`.
- Method API yang salah untuk route API dikembalikan sebagai `404 Not Found` generik.
- `public/robots.txt` menolak crawler untuk `/api`, `/admin`, dan `/manager`.
- Caddy edge proxy menambahkan HSTS untuk host HTTPS production.
- Caddy production memakai custom image dengan Coraza WAF untuk memblokir probe
  high-confidence: scanner user-agent, path sensitif, SQLi, XSS, dan path traversal.
- `wa.sismu.biz.id` tidak lagi menampilkan root welcome/manager panel publik dari
  Caddy; `/` dan `/manager*` dikembalikan sebagai `404`.
- Build frontend dipisah per area role agar kode admin/guru/siswa tidak masuk satu chunk utama.
- Referensi domain lama diganti ke `sismu.biz.id`.

## Status VPS 12 Juni 2026

- UFW sudah aktif dengan default deny incoming dan hanya port aplikasi yang terbuka.
- Fail2Ban SSH sudah aktif.
- Validasi build Caddy WAF lokal di VPS pernah dicoba di direktori sementara, tetapi
  compile Coraza gagal karena disk root VPS hampir penuh. Cache build Docker dari
  validasi tersebut sudah dibersihkan.
- Sisa disk root setelah pembersihan sekitar 2.4 GB. Untuk produksi, tambah kapasitas
  disk atau jadwalkan pembersihan image/log Docker agar deploy berikutnya tidak gagal
  karena ruang habis.
- SSH password/root login belum dimatikan langsung agar akses admin dan GitHub Actions
  deploy tidak terkunci. Matikan password login hanya setelah key admin/deploy sudah
  diverifikasi bisa login.
- Port MQTT `8883` belum di-allowlist karena IP perangkat RFID belum dipastikan statis.
  Jangan tutup port ini sebelum perangkat dipindahkan ke IP statis atau VPN.

## DNS Wajib

Buat record eksplisit saja:

```text
sismu.biz.id              A  IP_VPS
admin26.sismu.biz.id      A  IP_VPS
wa.sismu.biz.id           A  IP_VPS
mqtt.sismu.biz.id         A  IP_VPS
namasekolah.sismu.biz.id  A  IP_VPS
```

Jangan buat wildcard `*.sismu.biz.id` untuk produksi. Jika wildcard pernah dibuat,
hapus dari panel DNS lalu tunggu propagasi TTL.

Aktifkan DNSSEC di panel DNS/registrar jika provider mendukung.

## VPS Firewall

Contoh baseline UFW:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from <IP_ADMIN> to any port 22 proto tcp
sudo ufw allow from <IP_RFID_SEKOLAH> to any port 8883 proto tcp
sudo ufw enable
sudo ufw status verbose
```

Jika IP RFID belum statis, jangan langsung menutup `8883` sebelum perangkat siap
dipindah ke IP allowlist/VPN.

## SSH Hardening

Edit `/etc/ssh/sshd_config`:

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers <user_deploy>
```

Lalu reload:

```bash
sudo sshd -t
sudo systemctl reload ssh
```

Pastikan key SSH admin/deploy sudah bisa login sebelum mematikan password.

## Evolution API / WhatsApp

`wa.sismu.biz.id` tidak boleh menjadi manager publik tanpa proteksi.

Wajib:

- Gunakan `EVOLUTION_API_KEY` panjang dan acak.
- Jangan simpan key di frontend, Git, atau artifact build.
- Manager publik sudah diblokir di Caddy (`/manager*` -> `404`).
- Jika manager Evolution tetap diperlukan, akses lewat tunnel/VPN internal, bukan publik.
- Alur normal EduSmart cukup memakai menu WhatsApp di aplikasi, bukan manager publik.

Env production yang relevan:

```text
EVOLUTION_PUBLIC_URL=https://wa.sismu.biz.id
CADDY_EVOLUTION_HOST=wa.sismu.biz.id
EVOLUTION_CORS_ORIGIN=https://wa.sismu.biz.id
EVOLUTION_API_WEBHOOK_BASE_URL=https://sismu.biz.id
```

## MQTT / RFID

Gunakan host production:

```text
RFID_MOSQUITTO_PUBLIC_HOST=mqtt.sismu.biz.id
RFID_MOSQUITTO_PUBLIC_PORT=8883
RFID_MQTT_USE_TLS=true
RFID_MQTT_TLS_VERIFY_PEER=true
RFID_MQTT_TLS_VERIFY_PEER_NAME=true
RFID_MQTT_TLS_ALLOW_SELF_SIGNED=false
```

Jika file cert Mosquitto lama masih self-signed untuk domain lain, regenerasi atau
ganti dengan certificate untuk `mqtt.sismu.biz.id`, lalu restart:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart mosquitto mosquitto_reloader rfid_bridge
```

Port `8883` sebaiknya hanya dibuka untuk IP perangkat RFID sekolah atau lewat VPN.

## Fail2Ban

Minimal aktifkan jail SSH:

```bash
sudo apt-get update
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

Tambahkan jail Nginx/Caddy jika log VPS sudah stabil dan path log sudah jelas.

## WAF / Reverse Proxy

Production Caddy dibuild dari `deploy/caddy/Dockerfile` dengan plugin Coraza.
Rule yang aktif sengaja high-confidence agar aman untuk produksi awal:

- scanner user-agent umum (`sqlmap`, `nikto`, `nuclei`, dan sejenisnya);
- akses file/path sensitif seperti `.env`, `.git`, `wp-admin`, `phpmyadmin`;
- pola SQL injection, XSS, dan path traversal yang jelas;
- upload tugas/storage dilewatkan dari WAF supaya request body besar tidak mengganggu workflow sekolah.

Setelah traffic nyata stabil, CRS penuh bisa diuji dulu di staging/detect-only
sebelum dinaikkan ke blocking mode.

## Setelah Deploy

Jalankan smoke check:

```bash
curl -I https://sismu.biz.id
curl -I https://admin26.sismu.biz.id
curl -i https://sismu.biz.id/api/auth/me
curl -i -X POST https://sismu.biz.id/api/db -H 'Content-Type: application/json' -d '{"table":"settings","action":"select"}'
```

Ekspektasi:

- Header `strict-transport-security` muncul di HTTPS.
- `/api/auth/me` tanpa login menghasilkan `401`.
- `/api/db` tanpa login menghasilkan `401`.
- Domain lama tidak dipakai lagi.
