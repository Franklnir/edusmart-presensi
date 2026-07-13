# API V2 Migration Plan

## Visi V2
- Menggantikan endpoint tunggal berbasis payload GraphQL-like (`POST /api/db`) dengan arsitektur RESTful yang memanfaatkan FormRequests, Policies, Resources, dan spesialisasi Controllers.

## Fase Transisi
### 1. Persiapan Baseline (Current Phase)
- Fokus menambal bug `404 Not Found` pada auth check (mengakibatkan infinite loop di klien).
- Fokus menangani exception crash pada pemanggilan string di klien (seperti `.toLowerCase()`).
- Endpoint `/api/db` dibiarkan utuh dan dioperasikan seperti biasa.

### 2. Implementasi V2 Rangka Dasar
- Membangun `api_v2.php` di Laravel yang terpisah dari route lama.
- Membuat abstraksi untuk `TenantScope` di Eloquent model jika belum diterapkan sempurna.
- Membuat endpoint V2 pertama (contohnya `GET /api/v2/classes`, `GET /api/v2/students`).

### 3. Strangler Fig Pattern (Adopsi Bertahap)
- Mengalihkan halaman atau komponen React satu per satu untuk mulai memfetch via endpoint `v2` alih-alih melalui modul `supabase.js` yang mengeksekusi `/api/db`.
- Mempertahankan `DbController` dan rute lawas sebagai "Compatibility Layer".

### 4. Depresiasi Akhir
- Begitu seluruh dashboard admin, dashboard guru, dan halaman mobile di sisi React telah beralih sepenuhnya ke `v2`, modul `supabase.js` frontend dan `/api/db` backend akan dihapus secara permanen.
