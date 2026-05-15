import {
  SISWA_IMPORT_EXAMPLE_COLUMNS,
  SISWA_IMPORT_EXAMPLE_HEADERS,
} from './studentFormatters'

const FALLBACK_KELAS = ['X IPA 1', 'X IPA 2']
const SAMPLE_NAMES = [
  'Alya Putri Ramadhani',
  'Raka Pratama Saputra',
  'Nabila Azzahra Putri',
  'Fahri Maulana Akbar',
  'Siti Nurhaliza',
  'Dimas Aditya Pratama',
  'Citra Lestari',
  'Bagas Permana',
  'Keysa Maharani',
  'Rizky Kurniawan',
]
const SAMPLE_RELIGIONS = [
  'Islam',
  'Islam',
  'Islam',
  'Islam',
  'Islam',
  'Islam',
  'Kristen',
  'Islam',
  'Islam',
  'Katolik',
]
const SAMPLE_ADDRESSES = [
  'Jl. Melati 12, Bandung',
  'Jl. Kenanga 8, Bandung',
  'Jl. Anggrek 5, Bandung',
  'Jl. Cempaka 17, Bandung',
  'Jl. Mawar 10, Bandung',
  'Jl. Flamboyan 2, Bandung',
  'Jl. Teratai 9, Bandung',
  'Jl. Wijaya Kusuma 4, Bandung',
  'Jl. Dahlia 7, Bandung',
  'Jl. Bougenville 14, Bandung',
]

const getImportExampleValues = (row) => (
  SISWA_IMPORT_EXAMPLE_COLUMNS.map(({ key }) => row[key] ?? '')
)

export function buildImportExampleRows(availableKelasNames) {
  const classNames = availableKelasNames.length ? availableKelasNames : FALLBACK_KELAS

  return classNames.map((kelasName, index) => {
    const sampleName = SAMPLE_NAMES[index] || `Contoh Siswa ${index + 1}`
    const month = String((index % 12) + 1).padStart(2, '0')
    const day = String(((index * 3) % 28) + 1).padStart(2, '0')
    const nis = `2401${String(index + 1).padStart(3, '0')}`

    return {
      nama: sampleName,
      nis,
      kelas: kelasName,
      jk: index % 2 === 0 ? 'P' : 'L',
      tanggal_lahir: `2010-${month}-${day}`,
      agama: SAMPLE_RELIGIONS[index] || 'Islam',
      alamat: SAMPLE_ADDRESSES[index] || `Jl. Contoh ${index + 1}, Bandung`,
      no_hp_siswa: `08123${String(4567890 + index).padStart(7, '0')}`,
      no_hp_wali: `08129${String(8765432 + index).padStart(7, '0')}`,
    }
  })
}

export function buildImportExampleCopyText(importExampleRows) {
  const headerLine = SISWA_IMPORT_EXAMPLE_HEADERS.join('\t')
  const bodyLines = importExampleRows.map((row) => getImportExampleValues(row).join('\t'))

  return [headerLine, ...bodyLines].join('\n')
}

export function buildImportExampleExcelRows(importExampleRows) {
  return importExampleRows.map((row) => {
    const item = {}
    SISWA_IMPORT_EXAMPLE_COLUMNS.forEach(({ key, label }) => {
      item[label] = row[key] ?? ''
    })
    return item
  })
}
