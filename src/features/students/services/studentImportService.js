import { supabase } from '../../../lib/supabase'
import { isEmailFormat } from '../../../utils/accountSetup'
import { buildDefaultPassword, normalizeIdentifierCode } from '../../../utils/importUtils'
import { createClientUuid } from '../utils/studentFormatters'

export async function fetchStudentImportHistoryItems(historyId) {
  const { data, error } = await supabase
    .from('import_siswa_history_items')
    .select('*')
    .eq('history_id', historyId)
    .order('id', { ascending: true })

  if (error) throw error
  return data || []
}

export async function fetchStudentImportHistories(limit = 50) {
  const { data, error } = await supabase
    .from('import_siswa_histories')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function markStudentImportHistorySaved(historyId) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('import_siswa_histories')
    .update({
      status: 'saved',
      saved_at: now,
      updated_at: now,
    })
    .eq('id', historyId)

  if (error) throw error
}

export async function deleteStudentImportHistoryBatch(historyId) {
  const { error: deleteItemsError } = await supabase
    .from('import_siswa_history_items')
    .delete()
    .eq('history_id', historyId)
  if (deleteItemsError) throw deleteItemsError

  const { error: deleteHistoryError } = await supabase
    .from('import_siswa_histories')
    .delete()
    .eq('id', historyId)
  if (deleteHistoryError) throw deleteHistoryError
}

export async function runStudentImportBatch(payload = {}) {
  const { data, error } = await supabase.admin.importStudents(payload)
  if (error) throw error
  return data || {}
}

export async function persistStudentImportHistory({
  userId,
  importSource,
  importFileName,
  sheetUrl,
  totalRows,
  summary,
  itemRows,
}) {
  const now = new Date().toISOString()
  const historyId = createClientUuid()

  const historyPayload = {
    id: historyId,
    admin_id: userId || null,
    source: importSource === 'sheet' ? 'sheet' : 'file',
    file_name: importSource === 'file' ? (importFileName || null) : null,
    sheet_url: importSource === 'sheet' ? (String(sheetUrl || '').trim() || null) : null,
    status: 'pending',
    total_rows: totalRows,
    success_rows: summary.created + summary.updated + summary.skipped,
    created_rows: summary.created,
    updated_rows: summary.updated,
    skipped_rows: summary.skipped,
    failed_rows: summary.failed,
    saved_at: null,
    created_at: now,
    updated_at: now,
  }

  const { error: historyError } = await supabase
    .from('import_siswa_histories')
    .insert(historyPayload)

  if (historyError) throw historyError

  if (itemRows.length) {
    const withHeader = itemRows.map((item) => ({
      ...item,
      history_id: historyId,
      imported_at: item.imported_at || now,
      created_at: now,
      updated_at: now,
    }))

    const { error: itemError } = await supabase
      .from('import_siswa_history_items')
      .insert(withHeader)

    if (itemError) throw itemError
  }

  return historyId
}

export async function upsertImportedStudentRow(row) {
  const nis = normalizeIdentifierCode(row.nis)
  const nama = row.nama
  const emailLower = row.email ? row.email.toLowerCase() : ''
  const hasEmail = isEmailFormat(emailLower)
  const password = buildDefaultPassword(row.tanggal_lahir, nis)

  let { data: existing, error: exError } = await supabase
    .from('profiles')
    .select('id, role, email, nis, created_via')
    .ilike('nis', nis)
    .limit(1)
    .maybeSingle()

  if (exError) throw exError

  if (!existing && hasEmail) {
    const { data: byEmail } = await supabase
      .from('profiles')
      .select('id, role, email, nis, created_via')
      .eq('email', emailLower)
      .maybeSingle()
    existing = byEmail || null
  }

  const payload = {
    updated_at: new Date().toISOString(),
  }

  if (row.nama) payload.nama = row.nama
  if (nis) payload.nis = nis
  if (row.kelas) payload.kelas = row.kelas
  if (row.jk) payload.jk = row.jk
  if (row.tanggal_lahir) payload.tanggal_lahir = row.tanggal_lahir
  if (row.agama) payload.agama = row.agama
  if (row.alamat) payload.alamat = row.alamat
  if (row.telp) payload.telp = row.telp
  if (row.no_hp_siswa) payload.no_hp_siswa = row.no_hp_siswa
  if (row.no_hp_wali) payload.no_hp_wali = row.no_hp_wali
  if (row.status) payload.status = row.status

  if (existing?.id) {
    if (existing.role && existing.role !== 'siswa') {
      throw new Error('NIS sudah digunakan untuk role lain')
    }

    const existingEmail = String(existing.email || '').trim().toLowerCase()
    if (hasEmail && existingEmail !== emailLower) {
      payload.email = emailLower
    }

    const updateKeys = Object.keys(payload).filter((key) => key !== 'updated_at')
    if (!updateKeys.length && existing.created_via) {
      return {
        status: 'skipped',
        profileId: existing.id,
      }
    }

    const provisionPayload = {
      id: existing.id,
      nama,
      email: hasEmail ? emailLower : (existing.email || ''),
      password,
      role: 'siswa',
      sync_existing: true,
      created_via: 'import',
    }
    if (nis) provisionPayload.nis = nis
    if (row.kelas) provisionPayload.kelas = row.kelas
    if (row.jk) provisionPayload.jk = row.jk
    if (row.tanggal_lahir) provisionPayload.tanggal_lahir = row.tanggal_lahir
    if (row.agama) provisionPayload.agama = row.agama
    if (row.alamat) provisionPayload.alamat = row.alamat
    if (row.telp) provisionPayload.telp = row.telp
    if (row.no_hp_siswa) provisionPayload.no_hp_siswa = row.no_hp_siswa
    if (row.no_hp_wali) provisionPayload.no_hp_wali = row.no_hp_wali
    if (payload.status) provisionPayload.status = payload.status

    const { error: provisionError } = await supabase.admin.provisionUser(provisionPayload)

    if (provisionError) throw provisionError
    return {
      status: 'updated',
      profileId: existing.id,
    }
  }

  const { data: provisionData, error: provisionError } = await supabase.admin.provisionUser({
    nama,
    email: hasEmail ? emailLower : '',
    password,
    role: 'siswa',
    nis,
    kelas: row.kelas || '',
    jk: row.jk || '',
    tanggal_lahir: row.tanggal_lahir || '',
    agama: row.agama || '',
    alamat: row.alamat || '',
    telp: row.telp || '',
    no_hp_siswa: row.no_hp_siswa || '',
    no_hp_wali: row.no_hp_wali || '',
    status: payload.status || 'active',
    must_change_password: true,
    created_via: 'import',
  })

  if (provisionError) throw provisionError
  const newUserId = provisionData?.user?.id || provisionData?.profile?.id
  if (!newUserId) throw new Error('User gagal dibuat')

  return {
    status: 'created',
    profileId: newUserId,
  }
}
