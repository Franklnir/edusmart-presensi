# Daftar Kandidat Hapus (Dead Code)

Selama proses audit, fitur yang ada cukup aktif, namun pola query berbasis `/api/db` dari frontend (`src/lib/supabase.js`) akan bertahap digantikan. File dan kode yang menjadi kandidat untuk dihapus (TIDAK SEKARANG, tapi di fase akhir refactor) adalah:

1. **`src/lib/supabase.js`**
   - **Alasan:** Ini adalah wrapper query builder `supabase.from()` untuk berkomunikasi dengan `/api/db` (Laravel). Saat aplikasi bertransisi ke API V2 yang resource-based (RESTful endpoints sesungguhnya), query dinamis dari sisi client ini tidak akan diperlukan lagi dan fungsinya dapat diganti dengan library React Query biasa seperti `axios` / `fetch`.
2. **`backend/app/Http/Controllers/Api/DbController.php`**
   - **Alasan:** Universal Endpoint `handle()` ini sangat panjang (ribuan baris) yang menangani insert/select/update/delete untuk semua tabel. Ini harus di-split menjadi controller terpisah (SiswaController, KelasController, JadwalController, dll).
3. **Beberapa Service Terkait DbController:**
   - `DbInsertExecutor`, `DbSelectExecutor`, `DbUpdateExecutor`, `DbUpsertExecutor`
   - **Alasan:** Service pattern spesifik ini ada untuk melayani `/api/db`. Setelah beralih ke RESTful endpoint V2 dengan FormRequests standar Laravel, kelas-kelas ini akan usang.

*Catatan: Penghapusan dilarang keras dilakukan pada Fase 1. File ini hanya dokumentasi.*
