# Dependency Security Plan (Frontend)

Dokumen ini mencatat hasil hardening dependency dan risiko residual yang masih tersisa.

## Status Saat Ini

- Vulnerability `critical` dan `high` untuk production dependency frontend: **0**.
- Gate CI frontend menggunakan `npm run security:audit` dengan level `high`.
- Dependency `exceljs` dari npm sudah dilepas dari frontend untuk menghilangkan rantai transitive `archiver/glob/minimatch`.

## Perubahan yang Sudah Diterapkan

1. Upgrade package direct yang terdampak advisory:
   - `jspdf` -> `^4.2.0`
   - `jspdf-autotable` -> `^5.0.7`
   - `react-router-dom` -> `^6.30.3`
   - `swiper` -> `^12.1.2`
   - `vite` -> `^6.4.1`
2. Hapus package tidak terpakai dan berisiko:
   - `appwrite`
   - `react-query`
   - `react-qr-reader`
   - `xlsx`
   - `xlsx-js-style`
   - `envify`
   - `uglifyify`
3. Migrasi util import/export spreadsheet ke browser runtime loader (`/public/vendor/exceljs.min.js`) agar tidak menarik dependency Node-side yang rentan di `npm`.

## Risiko Residual

- Saat ini tidak ada temuan `high/critical` pada production dependency frontend dari hasil `npm audit`.
- Tetap lakukan audit berkala karena dependency tree dapat berubah saat upgrade minor.

## Rencana Bertahap

### Tahap 1 (sudah jalan)

- Terapkan gate `high` di CI.
- Kurangi attack surface dengan menghapus library lama yang tidak dipakai.

### Tahap 2 (lanjutan)

- SRI hash sudah diterapkan untuk loader `exceljs.min.js`.
- Tambah E2E smoke test khusus fitur export/import spreadsheet.

### Tahap 3 (target release mayor)

- Tambah SBOM sederhana + dependabot/renovate untuk patch rutin.
- Terapkan policy patch window (misal maksimal 7 hari untuk advisory baru level high+).
