import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const sourceRoot = join(root, 'src')
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.md'])

// Temporary migration allowlist. Each removal means one domain has stopped
// using the generic DB proxy; additions are intentionally forbidden by CI.
const allowedSupabaseConsumers = new Set([
  'src/docs/SWR_CACHING_GUIDE.md',
  'src/features/attendance/components/CalendarOverlay.jsx',
  'src/features/attendance/components/MapelOptions.jsx',
  'src/features/attendance/components/RingkasanKelasTable.jsx',
  'src/features/attendance/hooks/useStudentAttendanceActions.js',
  'src/features/attendance/hooks/useStudentAttendanceData.js',
  'src/features/attendance/hooks/useStudentRfidAttendanceListener.js',
  'src/features/students/hooks/useStudentClassActions.js',
  'src/features/students/hooks/useStudentDetailActions.js',
  'src/features/students/hooks/useStudentDetailData.js',
  'src/features/students/hooks/useStudentRfidActions.js',
  'src/features/students/services/studentImportService.js',
  'src/hooks/useStudentPeriodClass.js',
  'src/pages/admin/Guru.jsx',
  'src/pages/admin/Home.jsx',
  'src/pages/admin/Kelas.jsx',
  'src/pages/admin/PermissionAdmin.jsx',
  'src/pages/admin/Scan.jsx',
  'src/pages/admin/Sertifikat.jsx',
  'src/pages/admin/Siswa.jsx',
  'src/pages/admin/kelas/OrganisasiTab.jsx',
  'src/pages/admin/kelas/StrukturSekolahTab.jsx',
  'src/pages/admin/pengaturan.jsx',
  'src/pages/guru/AbsensiGuru.jsx',
  'src/pages/guru/JadwalGuru.jsx',
  'src/pages/guru/Laporan.jsx',
  'src/pages/guru/Quiz.jsx',
  'src/pages/guru/RapotSiswa.jsx',
  'src/pages/guru/TugasGuru.jsx',
  'src/pages/siswa/EditProfile.jsx',
  'src/pages/siswa/Home.jsx',
  'src/pages/siswa/Quiz.jsx',
  'src/pages/siswa/Tugas.jsx',
  'src/store/useAuthStore.js',
  'src/utils/absensiSettings.js'
])

const allowedDbProxyReferences = new Set([
  'src/lib/api/__tests__/client.test.js',
  'src/lib/api/__tests__/db.test.js',
  'src/lib/supabase.js',
  'src/pages/admin/MonitorLog.jsx',
  'src/pages/admin/SuperMonitorLog.jsx'
])

// This registry is intentionally immutable from the application migration
// script. A consumer may be removed as it migrates, but a new source file
// cannot be added to the allowlist to hide a newly introduced legacy call.
const approvedLegacySupabaseConsumers = new Set([
  'src/docs/SWR_CACHING_GUIDE.md',
  'src/features/attendance/components/CalendarOverlay.jsx',
  'src/features/attendance/components/MapelOptions.jsx',
  'src/features/attendance/components/RingkasanKelasTable.jsx',
  'src/features/attendance/hooks/useStudentAttendanceActions.js',
  'src/features/attendance/hooks/useStudentAttendanceData.js',
  'src/features/attendance/hooks/useStudentRfidAttendanceListener.js',
  'src/features/students/hooks/useStudentClassActions.js',
  'src/features/students/hooks/useStudentDetailActions.js',
  'src/features/students/hooks/useStudentDetailData.js',
  'src/features/students/hooks/useStudentRfidActions.js',
  'src/features/students/services/studentImportService.js',
  'src/hooks/useStudentPeriodClass.js',
  'src/pages/admin/Guru.jsx',
  'src/pages/admin/Home.jsx',
  'src/pages/admin/Kelas.jsx',
  'src/pages/admin/PermissionAdmin.jsx',
  'src/pages/admin/Scan.jsx',
  'src/pages/admin/Sertifikat.jsx',
  'src/pages/admin/Siswa.jsx',
  'src/pages/admin/kelas/OrganisasiTab.jsx',
  'src/pages/admin/kelas/StrukturSekolahTab.jsx',
  'src/pages/admin/pengaturan.jsx',
  'src/pages/guru/AbsensiGuru.jsx',
  'src/pages/guru/JadwalGuru.jsx',
  'src/pages/guru/Laporan.jsx',
  'src/pages/guru/Quiz.jsx',
  'src/pages/guru/RapotSiswa.jsx',
  'src/pages/guru/TugasGuru.jsx',
  'src/pages/siswa/EditProfile.jsx',
  'src/pages/siswa/Home.jsx',
  'src/pages/siswa/Quiz.jsx',
  'src/pages/siswa/Tugas.jsx',
  'src/store/useAuthStore.js',
  'src/utils/absensiSettings.js'
])

const approvedLegacyDbProxyReferences = new Set([
  'src/lib/api/__tests__/client.test.js',
  'src/lib/api/__tests__/db.test.js',
  'src/lib/supabase.js',
  'src/pages/admin/MonitorLog.jsx',
  'src/pages/admin/SuperMonitorLog.jsx'
])

for (const entry of allowedSupabaseConsumers) {
  if (!approvedLegacySupabaseConsumers.has(entry)) {
    console.error('API DB legacy migration gate failed: new Supabase allowlist entry ' + entry)
    process.exit(1)
  }
}

for (const entry of allowedDbProxyReferences) {
  if (!approvedLegacyDbProxyReferences.has(entry)) {
    console.error('API DB legacy migration gate failed: new DB proxy allowlist entry ' + entry)
    process.exit(1)
  }
}

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  if (entry.isDirectory()) return walk(path)
  return extensions.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [path] : []
})

const sourceFiles = walk(sourceRoot)
const violations = []
let supabaseCount = 0
let dbProxyCount = 0

for (const file of sourceFiles) {
  const relativePath = relative(root, file).replaceAll('\\', '/')
  const contents = readFileSync(file, 'utf8')

  if (/\bsupabase\s*\.\s*(?:from|rpc)\s*\(/s.test(contents)) {
    supabaseCount += 1
    if (!allowedSupabaseConsumers.has(relativePath)) {
      violations.push(`${relativePath}: generic supabase.from()/rpc() is not on the migration allowlist`)
    }
  }

  if (/['"`]\/api\/db(?:\/batch)?(?:[/'"`?]|$)|\bapi\/db(?:\/batch)?\b/s.test(contents)) {
    dbProxyCount += 1
    if (!allowedDbProxyReferences.has(relativePath)) {
      violations.push(`${relativePath}: /api/db reference is not on the migration allowlist`)
    }
  }
}

if (violations.length > 0) {
  console.error('API DB legacy migration gate failed:')
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

console.log(`API DB legacy migration gate passed: ${supabaseCount} generic consumer(s), ${dbProxyCount} proxy reference file(s) reviewed.`)
