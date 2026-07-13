# Security & Tenant Audit Report

## Security Audit
1. **API Exposure:** `/api/db` pada dasarnya adalah GraphQL miskin fitur. Meski `DbController` menerapkan berbagai policy (seperti mengecek scope tenant, role pengguna, dan mencegah edit data sensitif milik orang lain), endpoint ini tetap memungkinkan eksploitasi jika ada celah di dalam logika policy.
2. **Auth Handling:** Sistem menggunakan kombinasi Sanctum cookie-based (SPA) untuk web dan token-based untuk mobile. Ada Middleware `ConcealDbGatewayFromGuests` yang berusaha menyembunyikan endpoint dari guest. Bug pada middleware ini (hanya mengecek `bearerToken()` dan tidak mengecek cookie) menyebabkan 404 ketimbang 401.
3. **Frontend Vulnerabilities:** Peringatan hasil `npm audit` menunjukkan `launch-editor` NTLM disclosure (dari dependensi Vite) dan sourceMappingURL comment dari `@babel/core`. Tidak ada celah high severity yang terexpose ke sisi client production.

## Tenant Audit
1. **Arsitektur Multi-Tenant:** Menggunakan pendekatan `tenant_id` column pada tabel (Single Database, Shared Schema).
2. **Isolasi:** Middleware dan global scopes/query builder `DbController` memfilter berdasarkan `tenant_id` untuk tabel-tabel di `TENANT_SCOPED_TABLES`. Terdapat isolasi yang cukup baik secara query.
3. **Backup/Restore:** Backup Google Drive dikelola per tenant dan menggunakan format terisolasi, baik JSON yang mendukung checksum verifikasi mau pun Excel per tabel. Hal ini membantu mengamankan data tenant dalam backup terpisah.
