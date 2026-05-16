import { useCallback, useMemo, useState } from 'react'
import {
  buildGoogleSheetCsvUrl,
  readRowsFromFile,
  readRowsFromSheetUrl,
} from '../../../utils/importUtils'
import { exportRowsToExcel } from '../../../utils/spreadsheet'
import {
  deleteStudentImportHistoryBatch,
  fetchStudentImportHistories,
  fetchStudentImportHistoryItems,
  markStudentImportHistorySaved,
  persistStudentImportHistory,
  upsertImportedStudentRow,
} from '../services/studentImportService'
import { getKelasDisplayName } from '../utils/studentFormatters'
import {
  buildKelasLookup,
  getImportedKelasNames,
  getStudentImportBlockingErrorMessage,
  prepareStudentImportRows,
} from '../utils/studentImportParser'
import {
  buildImportExampleCopyText,
  buildImportExampleExcelRows,
  buildImportExampleRows,
} from '../utils/studentImportTemplate'

export function useStudentImport({
  kelasList,
  userId,
  pushToast,
  requestConfirmation,
  reloadStudents,
}) {
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importSource, setImportSource] = useState('file')
  const [importFile, setImportFile] = useState(null)
  const [sheetUrl, setSheetUrl] = useState('')
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importLoading, setImportLoading] = useState(false)
  const [importProgress, setImportProgress] = useState({ phase: 'idle' })
  const [importSummary, setImportSummary] = useState(null)
  const [importHistories, setImportHistories] = useState([])
  const [importHistoryItems, setImportHistoryItems] = useState([])
  const [selectedImportHistory, setSelectedImportHistory] = useState(null)
  const [importHistoryLoading, setImportHistoryLoading] = useState(false)
  const [importHistoryDetailLoading, setImportHistoryDetailLoading] = useState(false)
  const [importHistoryActionLoading, setImportHistoryActionLoading] = useState(false)

  const availableKelasNames = useMemo(
    () => kelasList.map((kelas) => getKelasDisplayName(kelas)).filter(Boolean),
    [kelasList]
  )

  const kelasLookup = useMemo(
    () => buildKelasLookup(kelasList),
    [kelasList]
  )

  const importExampleRows = useMemo(
    () => buildImportExampleRows(availableKelasNames),
    [availableKelasNames]
  )

  const importExampleCopyText = useMemo(
    () => buildImportExampleCopyText(importExampleRows),
    [importExampleRows]
  )

  const importExampleExcelRows = useMemo(
    () => buildImportExampleExcelRows(importExampleRows),
    [importExampleRows]
  )

  const importBlockingErrorMessage = useMemo(
    () => getStudentImportBlockingErrorMessage(importErrors),
    [importErrors]
  )

  const importedKelasNames = useMemo(
    () => getImportedKelasNames(importRows, kelasList),
    [importRows, kelasList]
  )

  const ensureKelasReadyForImport = useCallback(() => {
    if (kelasList.length) return true
    pushToast('error', 'Anda belum membuat kelas. Buat kelas terlebih dahulu sebelum import data siswa.')
    return false
  }, [kelasList.length, pushToast])

  const prepareImportRows = useCallback((rawRows) => {
    const { rows, errors } = prepareStudentImportRows(rawRows, kelasLookup)
    setImportRows(rows)
    setImportErrors(errors)
    setImportSummary(null)
    setImportProgress({
      phase: 'ready',
      current: 0,
      total: rows.length,
      failed: errors.length,
      message: rows.length
        ? `${rows.length} baris siap diimport${errors.length ? `, ${errors.length} baris perlu diperbaiki` : ''}.`
        : 'Belum ada baris valid untuk diimport.',
    })

    return { rows, errors }
  }, [kelasLookup])

  const copyImportExampleToClipboard = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      pushToast('error', 'Browser ini belum mendukung fitur salin otomatis.')
      return
    }

    try {
      await navigator.clipboard.writeText(importExampleCopyText)
      pushToast('success', 'Contoh format import berhasil disalin untuk Excel atau Google Sheets.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyalin contoh format import.')
    }
  }, [importExampleCopyText, pushToast])

  const downloadImportTemplateExcel = useCallback(async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const suffix = availableKelasNames.length
        ? `${availableKelasNames.length}-kelas`
        : 'template-default'
      const fileName = `template_import_siswa_${suffix}_${stamp}.xlsx`

      await exportRowsToExcel({
        rows: importExampleExcelRows,
        fileName,
        sheetName: 'Template Import Siswa',
      })

      pushToast('success', `Template Excel berhasil diunduh: ${fileName}`)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengunduh template Excel.')
    }
  }, [availableKelasNames.length, importExampleExcelRows, pushToast])

  const handleImportFileChange = useCallback(async (file) => {
    if (!file) return
    if (!ensureKelasReadyForImport()) return
    setImportFile(file)
    setImportLoading(true)
    setImportProgress({
      phase: 'reading',
      current: 0,
      total: 0,
      message: `Membaca file ${file.name}...`,
    })
    try {
      const rows = await readRowsFromFile(file)
      prepareImportRows(rows)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal membaca file')
    } finally {
      setImportLoading(false)
    }
  }, [ensureKelasReadyForImport, prepareImportRows, pushToast])

  const handleSheetUrlChange = useCallback((value) => {
    setSheetUrl(value)
  }, [])

  const handleLoadSheet = useCallback(async () => {
    if (!ensureKelasReadyForImport()) return
    const csvUrl = buildGoogleSheetCsvUrl(sheetUrl)
    if (!csvUrl) {
      pushToast('error', 'Link Google Sheets tidak valid')
      return
    }

    setImportLoading(true)
    setImportProgress({
      phase: 'reading',
      current: 0,
      total: 0,
      message: 'Mengambil data Google Sheets...',
    })
    try {
      const rows = await readRowsFromSheetUrl(csvUrl)
      prepareImportRows(rows)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengambil data Google Sheets')
    } finally {
      setImportLoading(false)
    }
  }, [ensureKelasReadyForImport, prepareImportRows, pushToast, sheetUrl])

  const resetImportState = useCallback(() => {
    setImportFile(null)
    setSheetUrl('')
    setImportRows([])
    setImportErrors([])
    setImportSummary(null)
    setImportProgress({ phase: 'idle' })
    setImportHistories([])
    setImportHistoryItems([])
    setSelectedImportHistory(null)
    setImportHistoryLoading(false)
    setImportHistoryDetailLoading(false)
    setImportHistoryActionLoading(false)
    setImportSource('file')
  }, [])

  const openImportModal = useCallback(() => {
    setImportModalOpen(true)
  }, [])

  const closeImportModal = useCallback(() => {
    setImportModalOpen(false)
    resetImportState()
  }, [resetImportState])

  const loadImportHistoryItems = useCallback(async (historyId) => {
    if (!historyId) {
      setImportHistoryItems([])
      return []
    }

    setImportHistoryDetailLoading(true)
    try {
      const rows = await fetchStudentImportHistoryItems(historyId)
      setImportHistoryItems(rows)
      return rows
    } catch (error) {
      console.error('Error loading import history detail:', error)
      pushToast('error', `Gagal memuat detail riwayat: ${error?.message || 'Unknown error'}`)
      setImportHistoryItems([])
      return []
    } finally {
      setImportHistoryDetailLoading(false)
    }
  }, [pushToast])

  const loadImportHistories = useCallback(async (preferredId = null) => {
    setImportHistoryLoading(true)
    try {
      const rows = await fetchStudentImportHistories()
      setImportHistories(rows)

      const target =
        rows.find((item) => item.id === preferredId) ||
        rows.find((item) => item.id === selectedImportHistory?.id) ||
        rows[0] ||
        null

      setSelectedImportHistory(target)
      if (target?.id) {
        await loadImportHistoryItems(target.id)
      } else {
        setImportHistoryItems([])
      }
    } catch (error) {
      console.error('Error loading import histories:', error)
      pushToast('error', `Gagal memuat riwayat import: ${error?.message || 'Unknown error'}`)
    } finally {
      setImportHistoryLoading(false)
    }
  }, [loadImportHistoryItems, pushToast, selectedImportHistory?.id])

  const switchImportSource = useCallback(async (nextSource) => {
    setImportSource(nextSource)
    if (nextSource === 'history') {
      await loadImportHistories()
    }
  }, [loadImportHistories])

  const openImportHistory = useCallback(async (history) => {
    if (!history?.id) return
    setSelectedImportHistory(history)
    await loadImportHistoryItems(history.id)
  }, [loadImportHistoryItems])

  const saveSelectedImportHistory = useCallback(async () => {
    if (!selectedImportHistory?.id) return

    setImportHistoryActionLoading(true)
    try {
      await markStudentImportHistorySaved(selectedImportHistory.id)
      pushToast('success', 'Riwayat import disimpan')
      await loadImportHistories(selectedImportHistory.id)
    } catch (error) {
      console.error('Error saving import history:', error)
      pushToast('error', `Gagal menyimpan riwayat: ${error?.message || 'Unknown error'}`)
    } finally {
      setImportHistoryActionLoading(false)
    }
  }, [loadImportHistories, pushToast, selectedImportHistory?.id])

  const deleteSelectedImportHistory = useCallback(async () => {
    if (!selectedImportHistory?.id) return

    const ok = window.confirm(
      'Hapus riwayat import ini? Data siswa yang sudah masuk tetap tersimpan.'
    )
    if (!ok) return

    setImportHistoryActionLoading(true)
    try {
      await deleteStudentImportHistoryBatch(selectedImportHistory.id)

      pushToast('success', 'Riwayat import dihapus. Data siswa tetap tersimpan.')

      await loadImportHistories()
      if (typeof reloadStudents === 'function') {
        await reloadStudents()
      }
    } catch (error) {
      console.error('Error deleting import history:', error)
      pushToast('error', `Gagal menghapus riwayat: ${error?.message || 'Unknown error'}`)
    } finally {
      setImportHistoryActionLoading(false)
    }
  }, [
    loadImportHistories,
    pushToast,
    reloadStudents,
    selectedImportHistory?.id,
  ])

  const handleRunImport = useCallback(async () => {
    if (!importRows.length) {
      pushToast('error', 'Tidak ada data untuk diimport')
      return
    }

    if (!ensureKelasReadyForImport()) {
      return
    }

    if (importErrors.length && !importRows.length) {
      pushToast('error', importBlockingErrorMessage)
      return
    }

    const kelasTersedia = importedKelasNames.length
      ? importedKelasNames.join(', ')
      : availableKelasNames.join(', ')

    const details = [
      `${importRows.length} baris valid akan diproses.`,
      `Kelas tujuan: ${kelasTersedia || '-'}.`,
    ]
    if (importErrors.length) {
      details.push(`${importErrors.length} baris error akan dilewati dan dicatat sebagai gagal.`)
    }

    const confirmed = requestConfirmation
      ? await requestConfirmation({
        title: 'Mulai import siswa?',
        message: 'Sistem akan membuat atau memperbarui akun siswa dari data yang sudah valid.',
        confirmText: 'Mulai Import',
        cancelText: 'Batal',
        tone: 'info',
        details,
      })
      : window.confirm(`Apakah Anda yakin ingin masukin ${importRows.length} data siswa valid dengan kelas ${kelasTersedia}?`)

    if (!confirmed) {
      return
    }

    setImportLoading(true)
    const summary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: importErrors.length,
      errors: importErrors.map((error) => ({
        row: error.row,
        reason: error.reason,
      })),
    }
    const historyItems = importErrors.map((error) => ({
      profile_id: null,
      status: 'failed',
      created_user: false,
      nis: null,
      nama: null,
      kelas: error.className || null,
      error_message: error.reason || 'Validasi gagal',
      imported_at: new Date().toISOString(),
    }))
    const totalRows = importRows.length
    let processedRows = 0
    setImportProgress({
      phase: 'processing',
      current: 0,
      total: totalRows,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: summary.failed,
      message: 'Memulai import data siswa...',
    })

    for (const row of importRows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await upsertImportedStudentRow(row)
        if (result?.status === 'created') summary.created += 1
        else if (result?.status === 'updated') summary.updated += 1
        else summary.skipped += 1

        historyItems.push({
          profile_id: result?.profileId || null,
          status: result?.status || 'skipped',
          created_user: result?.status === 'created',
          nis: row.nis || null,
          nama: row.nama || null,
          kelas: row.kelas_raw || row.kelas || null,
          error_message: null,
          imported_at: new Date().toISOString(),
        })
      } catch (error) {
        summary.failed += 1
        const reason = error?.message || 'Gagal memproses'
        summary.errors.push({
          row: row.__rowNum,
          reason,
        })
        historyItems.push({
          profile_id: null,
          status: 'failed',
          created_user: false,
          nis: row.nis || null,
          nama: row.nama || null,
          kelas: row.kelas_raw || row.kelas || null,
          error_message: reason,
          imported_at: new Date().toISOString(),
        })
      } finally {
        processedRows += 1
        setImportProgress({
          phase: 'processing',
          current: processedRows,
          total: totalRows,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          failed: summary.failed,
          message: `Memproses baris ${row.__rowNum}...`,
        })
        if (processedRows % 5 === 0) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
    }

    let historyId = null
    try {
      setImportProgress({
        phase: 'history',
        current: totalRows,
        total: totalRows,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        failed: summary.failed,
        message: 'Menyimpan riwayat import...',
      })
      historyId = await persistStudentImportHistory({
        userId,
        importSource,
        importFileName: importFile?.name,
        sheetUrl,
        totalRows: importRows.length + importErrors.length,
        summary,
        itemRows: historyItems,
      })
    } catch (error) {
      console.error('Error saving import history:', error)
      pushToast('warning', `Import selesai, tapi gagal menyimpan riwayat: ${error?.message || 'Unknown error'}`)
    }

    setImportSummary({
      ...summary,
      historyId,
    })
    setImportProgress({
      phase: 'done',
      current: totalRows,
      total: totalRows,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      message: 'Import siswa selesai.',
    })
    pushToast('success', `Import siswa selesai: ${summary.created} baru, ${summary.updated} update, ${summary.skipped} lewati, ${summary.failed} gagal.`)
    setImportLoading(false)

    if (typeof reloadStudents === 'function') {
      await reloadStudents()
    }

    if (historyId) {
      setImportSource('history')
      await loadImportHistories(historyId)
    }
  }, [
    availableKelasNames,
    ensureKelasReadyForImport,
    importBlockingErrorMessage,
    importErrors,
    importedKelasNames,
    importFile?.name,
    importRows,
    importSource,
    loadImportHistories,
    pushToast,
    requestConfirmation,
    reloadStudents,
    sheetUrl,
    userId,
  ])

  return {
    availableKelasNames,
    closeImportModal,
    copyImportExampleToClipboard,
    deleteSelectedImportHistory,
    downloadImportTemplateExcel,
    handleImportFileChange,
    handleLoadSheet,
    handleRunImport,
    handleSheetUrlChange,
    importBlockingErrorMessage,
    importErrors,
    importExampleCopyText,
    importExampleRows,
    importFile,
    importHistories,
    importHistoryActionLoading,
    importHistoryDetailLoading,
    importHistoryItems,
    importHistoryLoading,
    importLoading,
    importProgress,
    importModalOpen,
    importRows,
    importSource,
    importSummary,
    loadImportHistories,
    openImportHistory,
    openImportModal,
    saveSelectedImportHistory,
    selectedImportHistory,
    sheetUrl,
    switchImportSource,
  }
}
