# Quiz Scalability Runtime

Lapisan ini disiapkan untuk ujian dengan banyak siswa tanpa mengubah keamanan jawaban atau rumus nilai.

## Production Env

```env
QUIZ_CONTENT_CACHE_ENABLED=true
QUIZ_CONTENT_CACHE_TTL_SECONDS=300

# Aktifkan setelah container worker dipastikan sehat.
QUIZ_ASYNC_SCORING_ENABLED=true
QUIZ_SCORING_QUEUE=quiz-scoring
QUEUE_WORKER_PROCESSES=1
QUIZ_SCORING_WORKER_PROCESSES=0
QUIZ_WORKER_HEARTBEAT_MAX_AGE_SECONDS=150

QUIZ_MONITOR_WARNING_QUEUE_SIZE=100
QUIZ_MONITOR_CRITICAL_QUEUE_SIZE=500

# RFID high-volume scan tuning.
RFID_RATE_LIMIT_PER_MINUTE=3000
RFID_TENANT_CACHE_TTL_SECONDS=300
RFID_DEVICE_CACHE_TTL_SECONDS=60
RFID_DEVICE_AUTH_CACHE_TTL_SECONDS=300
RFID_DEVICE_SEEN_THROTTLE_SECONDS=30
RFID_ALWAYS_ACTIVE_CACHE_TTL_SECONDS=600
RFID_MQTT_MODE_PUBLISH_AFTER_SCAN_THROTTLE_SECONDS=5
RFID_DEVICE_EVENT_LOG_ENABLED=true
RFID_DEVICE_EVENT_CACHE_TTL_SECONDS=3600
```

Cache konten quiz selalu tenant-scoped dan otomatis dihapus saat quiz, soal, atau opsi diubah. Jika Redis bermasalah, aplikasi kembali membaca database.

Scoring queue bersifat idempotent dan memakai queue khusus `quiz-scoring`, sehingga pekerjaan nilai tidak menunggu job umum seperti notifikasi atau backup. Jika dispatch queue gagal, submit kembali menghitung nilai secara sinkron agar jawaban dan nilai tidak hilang.

## Deploy

```bash
php artisan migrate --force
php artisan config:clear
php artisan cache:clear
php artisan quiz:monitor
```

Pastikan `worker` dan `scheduler` aktif. Secara default satu proses worker tetap mendengarkan `quiz-scoring,default` agar kompatibel dengan VPS kecil. Saat `QUIZ_SCORING_WORKER_PROCESSES` lebih dari nol, container memisahkan proses queue umum dan proses khusus `quiz-scoring`. Jumlah proses dapat dinaikkan tanpa mengubah kode melalui `QUEUE_WORKER_PROCESSES` dan `QUIZ_SCORING_WORKER_PROCESSES`.

Rollout yang aman:

1. Deploy kode dan jalankan migration dengan `QUIZ_ASYNC_SCORING_ENABLED=false`.
2. Pastikan worker, scheduler, Redis, dan `php artisan quiz:monitor` sehat.
3. Aktifkan `QUIZ_ASYNC_SCORING_ENABLED=true`, lalu recreate `backend`, `worker`, dan `scheduler`.
4. Uji satu quiz kecil sebelum ujian besar. Nilai boleh tampil sebagai **Nilai diproses** selama job masih berada di antrean.

## Monitoring Saat Ujian

```bash
php artisan quiz:monitor
php artisan quiz:monitor --tenant=TENANT_UUID
```

Perintah menampilkan koneksi database, kesehatan cache, heartbeat worker scoring, backlog queue, failed jobs, serta jumlah submission berjalan dan selesai. Scheduler mengirim heartbeat ke queue setiap menit, sehingga status worker tidak hanya ditebak dari ukuran antrean.

Untuk memantau terus selama ujian:

```bash
watch -n 5 php artisan quiz:monitor
```

## Profil Kapasitas Tinggi

Untuk target 1.000 siswa serentak, gunakan VPS minimal 8 vCPU / 16 GB RAM dan override:

```bash
docker compose --env-file .env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.high-capacity.yml \
  up -d --force-recreate postgres redis backend worker scheduler nginx caddy
```

Override ini meningkatkan koneksi PostgreSQL, memory Redis, PHP-FPM children, dan jumlah worker scoring. Angka tersebut adalah titik awal, bukan jaminan kapasitas. Tetap ukur CPU, RAM, queue backlog, koneksi database, dan p95 response time.

Profil kapasitas tinggi juga menaikkan default `RFID_RATE_LIMIT_PER_MINUTE` menjadi `3000`, memperbesar resource `rfid_bridge`, mengurangi publish mode berulang setelah scan, dan mematikan log detail `rfid_device_events` secara default lewat `RFID_DEVICE_EVENT_LOG_ENABLED=false`. Jika RFID masuk dari satu gateway/MQTT bridge, rate limit rendah atau write log event berlebihan bisa menjadi bottleneck walaupun Mosquitto ringan.

## Load Test Staging

Gunakan staging dengan akun siswa khusus. Siapkan satu token berbeda untuk setiap siswa virtual agar pengujian benar-benar mewakili 100-500 siswa, bukan satu siswa yang mengirim request berulang. Skrip menolak domain `*.sismu.biz.id` kecuali override production diisi secara sadar.

```bash
k6 run \
  -e BASE_URL=https://staging.example.test \
  -e QUIZ_ID=QUIZ_UUID \
  -e AUTH_TOKENS="$(paste -sd, tokens-siswa-staging.txt)" \
  -e VUS=100 \
  scripts/load-tests/quiz-flow.k6.js
```

Naikkan bertahap: `100`, `250`, lalu `500` virtual users. Pantau `quiz:monitor`, PostgreSQL, Redis, CPU, RAM, dan log worker selama pengujian.

Untuk satu siswa saja, `AUTH_TOKEN` masih dapat dipakai dengan `VUS=1`.

## Simulasi Hari Sekolah

Skrip berikut menguji dua gelombang dengan akun yang sama: presensi QR pagi, lalu quiz siang. Siapkan QR yang masih aktif ketika skenario presensi dimulai dan quiz yang tersedia untuk seluruh akun pengujian.

Untuk banyak kelas, gunakan `ATTENDANCE_QR_TOKENS` dan `QUIZ_IDS` dengan satu nilai per siswa dalam urutan yang sama dengan `AUTH_TOKENS`. Satu `ATTENDANCE_QR_TOKEN` atau `QUIZ_ID` hanya cocok untuk pengujian ketika seluruh akun memang memakai jadwal atau quiz yang sama.

```bash
k6 run \
  -e BASE_URL=https://staging.example.test \
  -e ATTENDANCE_QR_TOKENS="$(paste -sd, token-qr-per-siswa.txt)" \
  -e QUIZ_IDS="$(paste -sd, quiz-id-per-siswa.txt)" \
  -e AUTH_TOKENS="$(paste -sd, tokens-siswa-staging.txt)" \
  -e STUDENTS=100 \
  -e QUIZ_START_DELAY=2m \
  scripts/load-tests/school-day-capacity.k6.js
```

Naikkan bertahap: `100`, `250`, `500`, `750`, lalu `1000`. Jangan melompat langsung ke 1.000. Target kelulusan awal:

- error rate di bawah 2%;
- p95 presensi di bawah 1,2 detik;
- p95 quiz di bawah 1,5 detik;
- tidak ada failed job;
- antrean `quiz-scoring` kembali turun setelah gelombang submit.

Jalankan k6 dari mesin terpisah yang cukup kuat agar generator beban tidak menjadi bottleneck. Untuk 1.000 VU, gunakan runner dengan resource memadai atau beberapa runner terdistribusi.

## Load Test RFID

RFID MQTT lebih ringan di sisi alat dan transport karena pesan masuk lewat broker, tetapi backend tetap menulis ke PostgreSQL melalui fungsi `absensi_rfid_auto`. Gunakan staging dan kartu siswa pengujian.

Untuk simulasi jalur Mosquitto asli, jalankan `rfid_bridge` dengan profile RFID. Untuk simulasi HTTP fallback, gunakan skrip berikut:

```bash
k6 run \
  -e BASE_URL=https://staging.example.test \
  -e TENANT_SLUG=sman3bogor \
  -e RFID_SHARED_KEY=secret-staging \
  -e RFID_CARD_UIDS="$(paste -sd, kartu-rfid-staging.txt)" \
  -e STUDENTS=100 \
  scripts/load-tests/rfid-scan.k6.js
```

Naikkan bertahap: `100`, `250`, `500`, `750`, lalu `1000`. Target awal:

- error rate di bawah 2%;
- p95 RFID di bawah 1,2 detik;
- tidak ada lonjakan failed query di log backend;
- CPU PostgreSQL tidak mentok terus-menerus;
- tidak ada rate-limit RFID saat mode high-capacity dipakai.
