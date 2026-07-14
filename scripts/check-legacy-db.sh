#!/bin/bash

# Pastikan script dijalankan dari root direktori proyek
cd "$(dirname "$0")/.."

echo "Memeriksa penggunaan consumer database legacy di Frontend..."

# Memeriksa penggunaan /api/db atau supabase.from()
# dengan mengecualikan file legacy yang memang belum di-migrate.
if rg -n "/api/db|supabase\.from\(" src \
  --glob '!src/legacy/**' \
  --glob '!src/services/supabaseAuthService.js' \
  --glob '!src/pages/admin/Sertifikat.jsx' \
  --glob '!src/pages/admin/Scan.jsx' \
  --glob '!src/pages/guru/TugasGuru.jsx' \
  --glob '!src/pages/siswa/EditProfile.jsx'; then
  
  echo "============================================================"
  echo "❌ ERROR: Terdeteksi penggunaan consumer database legacy baru!"
  echo "============================================================"
  echo "Harap gunakan Endpoint API V2 yang sesuai alih-alih /api/db"
  echo "atau supabase.from()."
  exit 1
fi

echo "✅ Pemeriksaan aman: Tidak ditemukan consumer legacy baru."
exit 0
