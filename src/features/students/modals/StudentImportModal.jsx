import React, { memo } from 'react'
import { formatDate } from '../../../lib/time'
import {
  IMPORT_SOURCE_LABEL,
  SISWA_IMPORT_EXAMPLE_COLUMNS,
} from '../utils/studentFormatters'
import {
  SPREADSHEET_IMPORT_ACCEPT,
  SPREADSHEET_IMPORT_FORMAT_LABEL,
} from '../../../utils/spreadsheet'

function SourceButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`px-4 py-2 rounded-lg text-sm font-medium border ${active
        ? 'bg-blue-600 text-white border-blue-600'
        : 'bg-white text-gray-700 border-gray-200'
        }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function StudentImportModal({
  isOpen,
  importSource,
  kelasList,
  availableKelasNames,
  importHistories,
  selectedImportHistory,
  importHistoryItems,
  importHistoryLoading,
  importHistoryDetailLoading,
  importHistoryActionLoading,
  importExampleRows,
  importExampleCopyText,
  importFile,
  importLoading,
  sheetUrl,
  importRows,
  importErrors,
  importBlockingErrorMessage,
  importProgress,
  importSummary,
  onClose,
  onSwitchSource,
  onRefreshHistories,
  onOpenHistory,
  onSaveHistory,
  onDeleteHistory,
  onCopyExample,
  onDownloadTemplate,
  onImportFileChange,
  onSheetUrlChange,
  onLoadSheet,
  onRunImport,
  getNamaKelas
}) {
  if (!isOpen) return null

  const canRunImport = Boolean(importRows.length && kelasList.length && !importLoading)
  const importButtonText = importLoading
    ? 'Memproses...'
    : importErrors.length > 0 && importRows.length > 0
      ? 'Import Data Valid'
      : 'Mulai Import'
  const importButtonHint = !kelasList.length
    ? 'Buat kelas terlebih dahulu sebelum import.'
    : !importRows.length && importErrors.length > 0
      ? 'Belum ada baris valid. Perbaiki error yang tampil dulu.'
      : !importRows.length
        ? 'Upload file atau ambil data Google Sheets terlebih dahulu.'
        : importErrors.length > 0
          ? `${importRows.length} baris valid bisa diimport, ${importErrors.length} baris error akan dilewati.`
          : ''
  const progress = importProgress || {}
  const progressTotal = Math.max(Number(progress.total || 0), 0)
  const progressCurrent = Math.min(Math.max(Number(progress.current || 0), 0), progressTotal || 0)
  const progressPercent = progressTotal > 0
    ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100))
    : progress.phase === 'done'
      ? 100
      : 0
  const progressSteps = [
    ['reading', 'Baca file'],
    ['ready', 'Validasi'],
    ['processing', 'Import'],
    ['history', 'Riwayat'],
    ['done', 'Selesai']
  ]
  const activeStepIndex = Math.max(0, progressSteps.findIndex(([key]) => key === progress.phase))
  const showProgress = importSource !== 'history' && (
    importLoading ||
    ['reading', 'ready', 'processing', 'history', 'done'].includes(progress.phase)
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Import Data Siswa</h3>
            <p className="text-sm text-gray-500">
              Upload Excel/CSV atau Google Sheets untuk membuat akun siswa otomatis.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            ✕ Tutup
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            <SourceButton active={importSource === 'file'} onClick={() => onSwitchSource('file')}>
              📁 Upload File
            </SourceButton>
            <SourceButton active={importSource === 'sheet'} onClick={() => onSwitchSource('sheet')}>
              📊 Google Sheets
            </SourceButton>
            <SourceButton active={importSource === 'history'} onClick={() => onSwitchSource('history')}>
              🕘 Riwayat Import
            </SourceButton>
          </div>

          {importSource !== 'history' && (
            <div className={`rounded-xl border p-4 text-sm ${kelasList.length
              ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
              : 'bg-red-50 border-red-200 text-red-800'
              }`}>
              <p className="font-semibold mb-1">
                {kelasList.length ? 'Konfirmasi kelas yang sudah dibuat' : 'Import ditolak sementara'}
              </p>
              {kelasList.length ? (
                <>
                  <p className="mb-3">
                    Apakah Anda yakin ingin masukin data siswa dengan kelas yang sudah kita buat?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availableKelasNames.map((kelasName) => (
                      <span
                        key={kelasName}
                        className="inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-xs font-semibold border border-indigo-200"
                      >
                        {kelasName}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p>
                  Anda belom membuat kelas, jadi upload Excel, CSV, atau Google Sheets belum bisa diproses.
                </p>
              )}
            </div>
          )}

          {importSource === 'history' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">
                    Daftar Riwayat
                  </p>
                  <button
                    type="button"
                    onClick={() => onRefreshHistories(selectedImportHistory?.id || null)}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    disabled={importHistoryLoading || importHistoryActionLoading}
                  >
                    Refresh
                  </button>
                </div>

                <div className="max-h-80 overflow-auto divide-y divide-gray-100">
                  {importHistoryLoading ? (
                    <div className="p-4 text-sm text-gray-500">Memuat riwayat...</div>
                  ) : importHistories.length ? (
                    importHistories.map((history) => {
                      const isActive = selectedImportHistory?.id === history.id
                      const title = history.file_name || (history.source === 'sheet' ? 'Google Sheets' : 'Tanpa nama file')
                      const sourceLabel = IMPORT_SOURCE_LABEL[history.source] || history.source || 'Unknown'
                      const statusLabel = history.status === 'saved' ? 'Tersimpan' : 'Draft'
                      const statusClass = history.status === 'saved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'

                      return (
                        <button
                          key={history.id}
                          type="button"
                          onClick={() => onOpenHistory(history)}
                          className={`w-full text-left px-4 py-3 transition-colors ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
                              <p className="text-xs text-gray-500">
                                {sourceLabel} • {formatDate(history.created_at)}
                              </p>
                              <p className="text-xs text-gray-600 mt-1">
                                Baru {history.created_rows || 0} • Update {history.updated_rows || 0} • Gagal {history.failed_rows || 0}
                              </p>
                            </div>
                            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="p-4 text-sm text-gray-500">Belum ada riwayat import.</div>
                  )}
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-900">
                    Detail Import
                  </p>
                </div>

                {!selectedImportHistory ? (
                  <div className="p-4 text-sm text-gray-500">
                    Pilih salah satu riwayat untuk melihat detail.
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="text-sm text-gray-700 space-y-1">
                      <p><span className="font-semibold">Sumber:</span> {IMPORT_SOURCE_LABEL[selectedImportHistory.source] || selectedImportHistory.source || 'Unknown'}</p>
                      <p><span className="font-semibold">File:</span> {selectedImportHistory.file_name || '—'}</p>
                      <p><span className="font-semibold">Dibuat:</span> {formatDate(selectedImportHistory.created_at)}</p>
                      <p><span className="font-semibold">Hasil:</span> Baru {selectedImportHistory.created_rows || 0} • Update {selectedImportHistory.updated_rows || 0} • Lewati {selectedImportHistory.skipped_rows || 0} • Gagal {selectedImportHistory.failed_rows || 0}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onSaveHistory}
                        disabled={importHistoryActionLoading || selectedImportHistory.status === 'saved'}
                        className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Simpan
                      </button>
                      <button
                        type="button"
                        onClick={onDeleteHistory}
                        disabled={importHistoryActionLoading}
                        className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Hapus Riwayat
                      </button>
                    </div>

                    <div className="text-xs text-gray-500">
                      Data siswa yang sudah masuk tetap tersimpan.
                    </div>

                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="max-h-44 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 text-left font-semibold text-gray-600">NIS</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-600">Nama</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-600">Kelas</th>
                              <th className="px-2 py-2 text-left font-semibold text-gray-600">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importHistoryDetailLoading ? (
                              <tr>
                                <td colSpan="4" className="px-2 py-3 text-center text-gray-500">
                                  Memuat detail...
                                </td>
                              </tr>
                            ) : importHistoryItems.length ? (
                              importHistoryItems.map((item) => (
                                <tr key={item.id} className="border-t border-gray-100">
                                  <td className="px-2 py-2">{item.nis || '—'}</td>
                                  <td className="px-2 py-2">{item.nama || '—'}</td>
                                  <td className="px-2 py-2">{getNamaKelas(item.kelas)}</td>
                                  <td className="px-2 py-2">
                                    <span className="font-semibold">{item.status}</span>
                                    {item.error_message ? (
                                      <p className="text-red-600 mt-0.5">{item.error_message}</p>
                                    ) : null}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan="4" className="px-2 py-3 text-center text-gray-500">
                                  Tidak ada detail item.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      Contoh format {importExampleRows.length} baris
                    </p>
                    <p className="text-xs text-gray-500">
                      Satu baris contoh untuk tiap kelas yang sudah dibuat. Bisa dipakai untuk Excel, CSV, atau langsung dipaste ke Google Sheets.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onCopyExample}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                    >
                      Copy Contoh
                    </button>
                    <button
                      type="button"
                      onClick={onDownloadTemplate}
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                    >
                      Download Template Excel
                    </button>
                  </div>
                </div>

                <div className="max-h-64 overflow-auto">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {SISWA_IMPORT_EXAMPLE_COLUMNS.map((column) => (
                          <th
                            key={column.key}
                            className="px-4 py-3 text-left font-semibold text-slate-600 border-b border-gray-200 sticky top-0 bg-slate-50"
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importExampleRows.map((row, idx) => (
                        <tr
                          key={`${row.nis}-${idx}`}
                          className={idx % 2 === 0 ? 'border-b border-gray-100 bg-white' : 'border-b border-gray-100 bg-slate-50/50'}
                        >
                          {SISWA_IMPORT_EXAMPLE_COLUMNS.map((column) => (
                            <td
                              key={`${row.nis}-${column.key}`}
                              className={`px-4 py-3 align-top text-gray-700 ${column.cellClassName}`}
                            >
                              {row[column.key] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold text-gray-700 mb-2">
                    Format yang bisa dicopy ke Excel / Google Sheets:
                  </p>
                  <textarea
                    readOnly
                    value={importExampleCopyText}
                    className="w-full min-h-[130px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 font-mono"
                    spellCheck={false}
                  />
                  <p className="mt-2 text-[11px] text-gray-500">
                    Template download memakai format Excel (`.xlsx`) supaya header dan kolom terlihat lebih rapi saat dibuka.
                  </p>
                </div>
              </div>

              {importSource === 'file' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept={SPREADSHEET_IMPORT_ACCEPT}
                    onChange={(e) => onImportFileChange(e.target.files?.[0])}
                    className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                    disabled={importLoading || !kelasList.length}
                  />
                  {importFile && (
                    <p className="text-xs text-gray-500">File terpilih: {importFile.name}</p>
                  )}
                </div>
              )}

              {importSource === 'sheet' && (
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Tempel link Google Sheets (publik)"
                    value={sheetUrl}
                    onChange={(e) => onSheetUrlChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm"
                    disabled={importLoading || !kelasList.length}
                  />
                  <button
                    type="button"
                    onClick={onLoadSheet}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                    disabled={importLoading || !sheetUrl.trim() || !kelasList.length}
                  >
                    Ambil Data
                  </button>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">Catatan penting</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Kolom wajib: <b>Nama</b>, <b>NIS</b>, dan <b>Kelas</b>.</li>
                  <li>Kolom <b>Email</b> opsional, jadi boleh dikosongkan dulu.</li>
                  <li>Kolom <b>JK</b> bisa diisi <b>L</b>/<b>P</b>, <b>Laki-laki</b>, <b>Laki laki</b>, <b>Perempuan</b>, atau <b>Perumpuan</b>.</li>
                  <li>Password awal sistem akan diamankan otomatis oleh server.</li>
                  <li>Untuk <b>login pertama</b>, siswa cukup pakai <b>tanggal lahir polos</b> (contoh 05/08/2010 → <b>05082010</b>).</li>
                  <li>Kalau <b>tanggal lahir</b> kosong, login pertama memakai <b>NIS</b> sebagai password sementara.</li>
                  <li>Usia akan dihitung otomatis dari tanggal lahir yang valid.</li>
                  <li>Login awal siswa: pakai <b>NIS</b> dan password sementara di atas.</li>
                  <li>Nama kelas harus mengarah ke kelas yang sudah dibuat di website ini.</li>
                  <li>NIS otomatis dirapikan menjadi huruf besar, jadi <b>s001</b> dan <b>S001</b> dianggap siswa yang sama.</li>
                  <li>Huruf besar dan kecil pada nama kelas tidak ngaruh, jadi <b>x ipa 1</b> dan <b>X IPA 1</b> akan dianggap sama.</li>
                  <li>Format upload yang didukung: <b>{SPREADSHEET_IMPORT_FORMAT_LABEL}</b>.</li>
                  <li>Setelah login, siswa wajib ganti password. Email bisa dilengkapi nanti kalau memang belum ada.</li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <div className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">
                  Data siap import: <b>{importRows.length}</b>
                </div>
                <div className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">
                  Error validasi: <b>{importErrors.length}</b>
                </div>
              </div>

              {importErrors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                  <p className="font-semibold mb-2">Contoh error</p>
                  {importRows.length > 0 ? (
                    <p className="mb-2">Baris yang valid tetap bisa diimport. Baris error akan dilewati dan masuk ringkasan gagal.</p>
                  ) : null}
                  {importBlockingErrorMessage ? (
                    <p className="mb-2">{importBlockingErrorMessage}</p>
                  ) : null}
                  <ul className="list-disc list-inside space-y-1 max-h-28 overflow-auto">
                    {importErrors.slice(0, 5).map((err, idx) => (
                      <li key={`${err.row}-${idx}`}>
                        Baris {err.row}: {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showProgress && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{progress.message || 'Menyiapkan import...'}</p>
                      <p className="text-xs text-blue-700">
                        {progressTotal > 0 ? `${progressCurrent}/${progressTotal} baris diproses` : 'Menyiapkan data'}
                      </p>
                    </div>
                    {importLoading ? (
                      <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
                    ) : (
                      <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">
                        {progressPercent}%
                      </span>
                    )}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {progressSteps.map(([key, label], index) => {
                      const done = index < activeStepIndex || progress.phase === 'done'
                      const active = index === activeStepIndex && progress.phase !== 'done'
                      return (
                        <div
                          key={key}
                          className={`rounded-lg border px-2 py-1.5 text-center text-xs font-semibold ${
                            done
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : active
                                ? 'border-blue-200 bg-white text-blue-700'
                                : 'border-blue-100 bg-blue-50/60 text-blue-500'
                          }`}
                        >
                          {label}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-800">
                    <span>Baru: <b>{progress.created || 0}</b></span>
                    <span>Update: <b>{progress.updated || 0}</b></span>
                    <span>Lewati: <b>{progress.skipped || 0}</b></span>
                    <span>Gagal: <b>{progress.failed || 0}</b></span>
                  </div>
                </div>
              )}

              {importSummary && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
                  <p className="font-semibold mb-2">Hasil Import</p>
                  <p>Baru: {importSummary.created} • Update: {importSummary.updated} • Lewati: {importSummary.skipped} • Gagal: {importSummary.failed}</p>
                  {importSummary.historyId ? (
                    <p className="mt-1 text-emerald-700">Riwayat tersimpan. Buka tab <b>Riwayat Import</b> untuk kelola batch ini.</p>
                  ) : null}
                  {importSummary.errors?.length ? (
                    <ul className="list-disc list-inside space-y-1 mt-2 max-h-28 overflow-auto">
                      {importSummary.errors.slice(0, 5).map((err, idx) => (
                        <li key={`${err.row}-${idx}`}>
                          Baris {err.row}: {err.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm"
          >
            Tutup
          </button>
          {importSource !== 'history' && (
            <button
              type="button"
              onClick={onRunImport}
              disabled={!canRunImport}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
            >
              {importButtonText}
            </button>
          )}
          {importSource !== 'history' && importButtonHint ? (
            <p className="basis-full text-right text-xs text-gray-500">{importButtonHint}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default memo(StudentImportModal)
