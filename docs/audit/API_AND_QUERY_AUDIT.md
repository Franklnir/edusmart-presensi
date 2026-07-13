# API & Query Audit Report

## Penggunaan `/api/db` (Universal API Endpoint)
- **Implementasi Backend:** Route `/api/db` diproses oleh `DbController@handle`. Frontend mengirimkan nama table, action (`select`, `insert`, `update`, `delete`, `upsert`), kolom, payload, dan filter.
- **Implementasi Frontend:** Terpusat pada class `QueryBuilder` di `src/lib/supabase.js`. Mengambil inspirasi dari SDK Supabase tetapi menerjemahkannya menjadi payload HTTP POST ke `/api/db`.
- **Masalah 400 Bad Request:** Muncul saat parameter `table` bernilai null atau nama tabel tidak terdapat di dalam `DbTableRegistry::ALLOWED_TABLES`. `table: undefined` bisa terkirim sebagai ketiadaan field, yang membuat backend gagal validasi.
- **Masalah 404 Not Found:** Muncul akibat middleware `ConcealDbGatewayFromGuests`. Jika user tidak memberikan Bearer Token (karena menggunakan cookie session Sanctum) dan belum authenticated, middleware mengembalikan HTTP 404 sebagai ganti 401. Hal ini merusak deteksi session expired pada client, sehingga client tidak meredirect ke login, melainkan melempar error tak tertangani.
- **Masalah Duplicate Requests (Looping):** Akibat client menerima 404 dari `/api/db` pada useEffect yang tidak memadai dalam menangani error "Not Found". Hal ini menyebabkan render ulang di React (React Strict Mode / query retry), berulang-ulang mencoba memfetch data meskipun tak memiliki akses (karena session/state tak memicu redirect login).

## Error Frontend Lainnya
- **Error `.toLowerCase()`:** Terdapat beberapa pemanggilan di frontend seperti `normalized.nis.toLowerCase()` di `Guru.jsx` dan `jabatan.toLowerCase()` di `StrukturSekolahTab.jsx` yang bisa crash (Uncaught TypeError: Cannot read properties of undefined (reading 'toLowerCase')) jika value undefined atau null. Perlu optional chaining dan fallback string.

## Evaluasi Kinerja
- **N+1 Queries:** Potensi masalah jika payload request `/api/db/batch` terlalu gemuk, meski `DbController` sudah berusaha mengaturnya dengan membatasi row maksimal (budget 5000 rows).
- **Coupling:** Frontend dan skema database sangat terikat ketat (tight coupling). Ini adalah anti-pattern yang berbahaya jika stuktur tabel diubah, tapi berguna untuk rapid prototyping. Migration ke API V2 mutlak diperlukan.
