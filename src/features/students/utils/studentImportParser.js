import {
  mapRowByAliases,
  normalizeGender,
  normalizeIdentifierCode,
  parseDateValue,
  toText,
} from '../../../utils/importUtils'
import {
  calculateAgeFromIsoDate,
  getKelasDisplayName,
  normalizeKelasKey,
  normalizePhoneID,
  normalizeStatusValue,
  SISWA_ALIAS_MAP,
  slugifyKelas,
} from './studentFormatters'

export function buildKelasLookup(kelasList) {
  const map = new Map()
  kelasList.forEach((kelas) => {
    const keys = [
      kelas.id,
      kelas.nama,
      `${kelas.grade || ''} ${kelas.suffix || ''}`.trim(),
      `${kelas.grade || ''}${kelas.suffix || ''}`.trim(),
      `${kelas.grade || ''}-${kelas.suffix || ''}`.trim(),
    ]
      .filter(Boolean)
      .map(normalizeKelasKey)

    keys.forEach((key) => {
      if (key) map.set(key, kelas.id)
    })
  })
  return map
}

export function resolveImportKelasId(value, kelasLookup) {
  if (!value) return ''
  const key = normalizeKelasKey(value)
  if (kelasLookup.has(key)) return kelasLookup.get(key)

  const slug = slugifyKelas(value)
  const slugKey = normalizeKelasKey(slug)
  return kelasLookup.get(slugKey) || ''
}

export function normalizeStudentImportRow(row, index, kelasLookup) {
  const mapped = mapRowByAliases(row, SISWA_ALIAS_MAP)
  const hasAny = Object.values(mapped).some((v) => String(v || '').trim() !== '')
  if (!hasAny) return null

  const kelasRaw = toText(mapped.kelas).toUpperCase()
  const resolvedKelas = resolveImportKelasId(kelasRaw, kelasLookup)
  const tanggalLahir = parseDateValue(mapped.tanggal_lahir)

  const telpRaw = toText(mapped.telp)
  const noHpSiswaRaw = toText(mapped.no_hp_siswa || mapped.telp)
  const noHpWaliRaw = toText(mapped.no_hp_wali)

  return {
    __rowNum: index + 2,
    nama: toText(mapped.nama),
    nis: normalizeIdentifierCode(mapped.nis),
    kelas: resolvedKelas,
    kelas_raw: kelasRaw,
    jk: normalizeGender(mapped.jk),
    tanggal_lahir: tanggalLahir,
    usia: calculateAgeFromIsoDate(tanggalLahir),
    agama: toText(mapped.agama),
    alamat: toText(mapped.alamat),
    telp: telpRaw ? normalizePhoneID(telpRaw) : '',
    no_hp_siswa: noHpSiswaRaw ? normalizePhoneID(noHpSiswaRaw) : '',
    no_hp_wali: noHpWaliRaw ? normalizePhoneID(noHpWaliRaw) : '',
    email: toText(mapped.email).toLowerCase(),
    status: normalizeStatusValue(mapped.status),
  }
}

export function prepareStudentImportRows(rawRows, kelasLookup) {
  const cleaned = []
  const errors = []
  const seenNis = new Map()
  const seenEmail = new Map()

  rawRows.forEach((row, idx) => {
    const normalized = normalizeStudentImportRow(row, idx, kelasLookup)
    if (!normalized) return

    if (!normalized.nis || !normalized.nama) {
      errors.push({
        row: normalized.__rowNum,
        reason: 'NIS dan Nama wajib diisi',
      })
      return
    }

    if (!normalized.kelas_raw) {
      errors.push({
        row: normalized.__rowNum,
        reason: 'Kelas wajib diisi',
      })
      return
    }

    if (!normalized.kelas) {
      errors.push({
        row: normalized.__rowNum,
        reason: `Maaf, kelas "${normalized.kelas_raw}" belum tersedia di website ini. Silakan buat terlebih dahulu.`,
        type: 'kelas_missing',
        className: normalized.kelas_raw,
      })
      return
    }

    const nisKey = normalized.nis.toLowerCase()
    if (seenNis.has(nisKey)) {
      errors.push({
        row: normalized.__rowNum,
        reason: `NIS duplikat dengan baris ${seenNis.get(nisKey)}`,
      })
      return
    }

    const emailKey = normalized.email.toLowerCase()
    if (emailKey && seenEmail.has(emailKey)) {
      errors.push({
        row: normalized.__rowNum,
        reason: `Email duplikat dengan baris ${seenEmail.get(emailKey)}`,
      })
      return
    }

    seenNis.set(nisKey, normalized.__rowNum)
    if (emailKey) seenEmail.set(emailKey, normalized.__rowNum)
    cleaned.push(normalized)
  })

  return { rows: cleaned, errors }
}

export function getStudentImportBlockingErrorMessage(importErrors) {
  if (!importErrors.length) return ''

  const importMissingKelasErrors = importErrors.filter((item) => item.type === 'kelas_missing')
  if (importMissingKelasErrors.length) {
    const missingNames = [
      ...new Set(importMissingKelasErrors.map((item) => item.className).filter(Boolean)),
    ]
    const suffix = missingNames.length ? ` Kelas yang belum tersedia: ${missingNames.join(', ')}.` : ''
    return `Maaf, kelas data siswa yang ada di file Excel, CSV, atau Google Sheets belum tersedia di website ini. Silakan buat terlebih dahulu.${suffix}`
  }

  return 'Masih ada data import yang belum valid. Perbaiki dulu semua error sebelum memulai import.'
}

export function getImportedKelasNames(importRows, kelasList) {
  return [
    ...new Set(
      importRows
        .map((row) => {
          const kelas = kelasList.find((item) => item.id === row.kelas)
          return getKelasDisplayName(kelas) || row.kelas_raw || row.kelas
        })
        .filter(Boolean)
    ),
  ]
}
