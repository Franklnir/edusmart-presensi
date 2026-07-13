# Tenant Audit Report

## 1. Mekanisme Isolasi Saat Ini
- **Desain Database:** Multi-tenant menggunakan arsitektur *Single Database, Shared Schema* dengan penambahan kolom `tenant_id` di setiap tabel tenant-scoped.
- **Routing & Resolusi:** `ResolveTenant` middleware bertanggung jawab mendeteksi tenant aktif berdasarkan URL / request header.
- **Enforcement (Penegakan Aturan):** Middleware `EnsureTenantMatchesProfile` memastikan pengguna hanya dapat mengakses data dalam tenant-nya. Pada `/api/db` (Universal Endpoint), `DbController@handle` secara otomatis menyisipkan klausul `WHERE tenant_id = ?` untuk tabel-tabel yang terdaftar di dalam konstanta `DbTableRegistry::TENANT_SCOPED_TABLES`.

## 2. Tingkat Keamanan Antar Tenant
Sistem isolasi yang ada saat ini cukup solid pada sisi backend berkat _implicit scoping_. Ketergantungan terhadap daftar hardcoded di `DbTableRegistry` berarti jika tabel baru tenant-scoped ditambahkan namun lupa dimasukkan ke registry, ada potensi kebocoran data (cross-tenant leakage). Sejauh ini, tabel vital semuanya sudah terdaftar.

## 3. Storage & Backup Isolation
File statis disimpan di object storage (mungkin AWS S3 / R2) dengan path storage memuat tenant slug sebagai namespace. Proses backup ke Google Drive yang baru ditambahkan juga mensimulasikan pemisahan ini, menaruh data dan spreadsheet ber-enkripsi/checksum per tenant secara terpisah, meminimalisir kemungkinan data tercampur di backup.

## Kesimpulan
Isolasi multi-tenant di aplikasi sudah diimplementasikan dengan sangat baik dan mature. Prioritas ke depan (saat membangun API V2) hanyalah menerjemahkan penegakan scope ini ke level Eloquent Global Scopes (sebagaimana best practices Laravel) agar lebih tahan terhadap "human error" pengembang di masa depan.
