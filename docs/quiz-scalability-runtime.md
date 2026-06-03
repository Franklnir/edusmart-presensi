# Quiz Scalability Runtime

Lapisan ini disiapkan untuk ujian dengan banyak siswa tanpa mengubah keamanan jawaban atau rumus nilai.

## Production Env

```env
QUIZ_CONTENT_CACHE_ENABLED=true
QUIZ_CONTENT_CACHE_TTL_SECONDS=300

# Aktifkan setelah container worker dipastikan sehat.
QUIZ_ASYNC_SCORING_ENABLED=true
QUIZ_SCORING_QUEUE=quiz-scoring
QUIZ_WORKER_HEARTBEAT_MAX_AGE_SECONDS=150

QUIZ_MONITOR_WARNING_QUEUE_SIZE=100
QUIZ_MONITOR_CRITICAL_QUEUE_SIZE=500
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

Pastikan `worker` dan `scheduler` aktif. Worker production mendengarkan `quiz-scoring,default`, dengan prioritas scoring quiz lebih dahulu.

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
