import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const directScheduleAccess = /\.from\(\s*['"]jadwal['"]\s*\)|table:\s*['"]jadwal['"]/g

// These are rollback-only compatibility paths. Every active V2 branch in this
// list is guarded by the feature flag or by loadScheduleRows(). New sources
// must be reviewed and deliberately added here; this avoids quiet regression
// to the generic database gateway.
const approvedLegacySources = new Set([
  'src/features/attendance/components/MapelOptions.jsx',
  'src/features/attendance/hooks/useStudentAttendanceData.js',
  'src/pages/admin/Kelas.jsx',
  'src/pages/admin/Scan.jsx',
  'src/pages/guru/AbsensiGuru.jsx',
  'src/pages/guru/JadwalGuru.jsx',
  'src/pages/guru/RapotSiswa.jsx',
  'src/pages/guru/TugasGuru.jsx',
  'src/pages/siswa/Tugas.jsx'
])

const guardedMarkers = [
  'USE_SCHEDULES_API_V2',
  'loadScheduleRows('
]

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const children = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(target)
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [target] : []
  }))

  return children.flat()
}

const files = await collectFiles(sourceRoot)
const directSources = []

for (const file of files) {
  const content = await readFile(file, 'utf8')
  if (!directScheduleAccess.test(content)) continue
  directScheduleAccess.lastIndex = 0

  const relative = path.relative(root, file).split(path.sep).join('/')
  directSources.push(relative)
  if (!approvedLegacySources.has(relative)) {
    throw new Error(`Schedule access outside reviewed rollback sources: ${relative}`)
  }
  if (!guardedMarkers.some((marker) => content.includes(marker))) {
    throw new Error(`Missing V2 schedule guard in legacy source: ${relative}`)
  }
}

const missingSources = [...approvedLegacySources].filter((source) => !directSources.includes(source))
if (missingSources.length > 0) {
  throw new Error(`Approved schedule source no longer contains a direct legacy access: ${missingSources.join(', ')}`)
}

console.log(`Schedule V2 static gate passed: ${directSources.length} reviewed rollback source(s).`)
