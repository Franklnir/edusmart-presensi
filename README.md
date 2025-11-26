# EduSmart (React + Firebase RTDB + Supabase Storage)

SaaS sekolah sederhana: autentikasi (role siswa/guru/admin), jadwal, absensi realtime, tugas & materi, kelola akun, dan upload via Supabase Storage.

## Stack
- React + Vite + React Router
- Zustand (state global) — Loading, Error, Success (toast)
- Tailwind CSS (Mobile-first, modern UI)
- Firebase Auth + Realtime Database (Asia Southeast rekomendasi)
- Supabase Storage (profiles, tugas)

Warna:
- Primary: `#2563EB`
- Hadir: `#16A34A` • Izin: `#F59E0B` • Alpha: `#DC2626`

## Jalankan Lokal
1. **Clone & install**
   ```bash
   npm i
   cp .env.example .env
   ```
2. **Isi `.env`** dengan kredensial Firebase & Supabase Anda.
3. **Tailwind & Dev server**
   ```bash
   npm run dev
   ```

## Konfigurasi Firebase
- Buat project → aktifkan Authentication (Email/Password) & Realtime Database.
- Atur **Database location**: `asia-southeast1` disarankan.
- Salin kredensial ke `.env`.
- Terapkan aturan `firebase.rules.json` (opsional: sesuaikan untuk produksi).

## Supabase Storage
- Buat bucket: `profiles` (public) dan `tugas` (public).
- Aktifkan **Public** untuk memudahkan akses file (atau implementasikan signed URL).
- Masukkan `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` ke `.env`.

## Struktur Data RTDB (ringkas)
```
users/{uid} => { role: 'siswa'|'guru'|'admin', nama, kelas, ... }
kelas/{nama} => { nama }
jadwal/{kelas}/{id} => { hari, mapel, guruId, guruNama, jamMulai, jamSelesai }
absensi/{kelas}/{YYYY-MM-DD}/{uid} => { status:'H'|'I'|'A', mapel, waktu }
absensi_ajuan/{kelas}/{YYYY-MM-DD}/{uid} => { alasan, nama }
tugas/{kelas}/{id} => { mapel, judul, keterangan, deadline, format }
kumpulan_tugas/{uid}/{idTugas} => { url, filename, uploadedAt }
ekskul/{id} => { nama, pembina, hari, jam }
jam_kosong/{YYYY-MM-DD}/{kelas}/{idJadwal} => { alasan, guruPengganti }
```

## Catatan Keamanan
- Aturan RTDB di sini **baseline**; sesuaikan untuk produksi.
- Batasi pendaftaran admin (`ALLOW_ADMIN_SELF_REGISTER=false` di `useAuthStore.js`).

## Rute
- `/login`, `/register`
- Siswa: `/home`, `/jadwal`, `/absensi`, `/tugas`, `/edit-profile`
- Guru: `/guru/jadwal`, `/guru/absensi`, `/guru/tugas`
- Admin: `/admin/kelas`, `/admin/siswa`, `/admin/guru`

## Fitur Penting
- **Realtime** badge "Live" pada ringkasan kelas, jam kosong, dll.
- **Disabled states** setelah deadline (tugas) / jam selesai (absensi).
- **Skeleton Loading** dan toast notifikasi sederhana.
- **Privasi** ringkasan absensi kelas menampilkan **agregat** tanpa nama siswa lain.

Selamat mencoba! 🚀
