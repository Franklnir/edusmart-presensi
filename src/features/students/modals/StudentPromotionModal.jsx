import React, { memo } from 'react'
import { Button, Input, Select } from '../../../pages/admin/siswa/SiswaUi'
import { getGradeLabel } from '../utils/studentFormatters'

function ModeButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`flex-1 px-3 py-2 rounded-lg border ${active
        ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
        : 'bg-gray-50 border-gray-300 text-gray-700'
        }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function buildDestinationOptions(kelasOptions, alumniYear, promoAlumni, promoMutasi) {
  return [
    { value: '', label: 'Pilih kelas tujuan' },
    ...kelasOptions.map(k => ({ value: k.value, label: k.label })),
    { value: promoAlumni, label: `Alumni (Lulus, tahun ${alumniYear || new Date().getFullYear()})` },
    { value: promoMutasi, label: 'Mutasi / Pindah Sekolah' }
  ]
}

function StudentPromotionModal({
  isOpen,
  mode,
  fromKelas,
  toKelas,
  loading,
  filterGrade,
  filterKelas,
  selectedIds,
  alumniYear,
  exitReason,
  candidateSiswa,
  kelasOptions,
  gradeLabels,
  promoAlumni,
  promoMutasi,
  getNamaKelas,
  onModeChange,
  onFromKelasChange,
  onToKelasChange,
  onFilterGradeChange,
  onFilterKelasChange,
  onToggleSelect,
  onToggleSelectAllVisible,
  onAlumniYearChange,
  onExitReasonChange,
  onClose,
  onConfirm
}) {
  if (!isOpen) return null

  const isExitMode = toKelas === promoAlumni || toKelas === promoMutasi
  const destinationOptions = buildDestinationOptions(kelasOptions, alumniYear, promoAlumni, promoMutasi)
  const allVisibleSelected =
    candidateSiswa.length > 0 &&
    candidateSiswa.every(s => selectedIds.includes(s.id))

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <span className="text-xl">^</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Kenaikan Kelas</h3>
            <p className="text-gray-600 text-sm">
              Pindahkan kelas siswa secara massal atau pilih siswa manual dari sini.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2 text-sm">
            <ModeButton active={mode === 'kelas'} onClick={() => onModeChange('kelas')}>
              Berdasarkan Kelas
            </ModeButton>
            <ModeButton active={mode === 'selected'} onClick={() => onModeChange('selected')}>
              Pilih Siswa Manual ({selectedIds.length})
            </ModeButton>
          </div>

          {mode === 'kelas' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Kelas Asal"
                value={fromKelas}
                onChange={e => onFromKelasChange(e.target.value)}
                options={[
                  { value: '', label: 'Pilih kelas asal' },
                  ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                ]}
              />
              <Select
                label="Kelas Tujuan"
                value={toKelas}
                onChange={e => onToKelasChange(e.target.value)}
                options={destinationOptions}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                Pilih siswa yang akan dipindahkan ke kelas tujuan. Bisa filter berdasarkan tingkatan dan kelas asal.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select
                  label="Filter Tingkatan"
                  value={filterGrade}
                  onChange={e => onFilterGradeChange(e.target.value)}
                  options={[
                    { value: '', label: 'Semua tingkatan' },
                    ...gradeLabels.map(g => ({ value: g, label: g }))
                  ]}
                />
                <Select
                  label="Filter Kelas Asal"
                  value={filterKelas}
                  onChange={e => onFilterKelasChange(e.target.value)}
                  options={[
                    { value: '', label: 'Semua kelas' },
                    ...kelasOptions
                      .filter(k => !filterGrade || getGradeLabel(k.value) === filterGrade)
                      .map(k => ({ value: k.value, label: k.label }))
                  ]}
                />
              </div>

              <div className="border rounded-lg max-h-56 overflow-y-auto">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                  <p className="text-xs text-gray-600">
                    Siswa terlihat: <span className="font-semibold">{candidateSiswa.length}</span>
                    {' '}- Dipilih: <span className="font-semibold">{selectedIds.length}</span>
                  </p>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline disabled:text-gray-400"
                    onClick={onToggleSelectAllVisible}
                    disabled={!candidateSiswa.length}
                  >
                    {allVisibleSelected ? 'Hapus pilih semua' : 'Pilih semua yang terlihat'}
                  </button>
                </div>

                {candidateSiswa.length ? (
                  <ul className="divide-y divide-gray-100">
                    {candidateSiswa.map(s => (
                      <li key={s.id} className="px-3 py-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                          checked={selectedIds.includes(s.id)}
                          onChange={() => onToggleSelect(s.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">
                            {s.nama || s.email || 'Tanpa nama'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {getNamaKelas(s.kelas)} - {s.email}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-gray-500">
                    Tidak ada siswa yang cocok dengan filter.
                  </div>
                )}
              </div>

              <Select
                label="Kelas Tujuan"
                value={toKelas}
                onChange={e => onToKelasChange(e.target.value)}
                options={destinationOptions}
              />

              {!selectedIds.length && (
                <p className="text-xs text-red-500">
                  Pilih minimal satu siswa untuk dipindahkan.
                </p>
              )}
            </div>
          )}

          {isExitMode && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-3">
              <p className="text-sm text-yellow-900">
                Mode khusus dipilih: <strong>{toKelas === promoAlumni ? 'Alumni (Lulus)' : 'Mutasi (Pindah Sekolah)'}</strong>.
                Tidak ada data riwayat yang dihapus.
              </p>

              {toKelas === promoAlumni && (
                <Input
                  label="Tahun Lulus"
                  type="number"
                  min="2000"
                  max="2100"
                  value={alumniYear}
                  onChange={(e) => onAlumniYearChange(e.target.value)}
                  placeholder="2025"
                />
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Alasan / Catatan *</label>
                <textarea
                  value={exitReason}
                  onChange={(e) => onExitReasonChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white resize-none"
                  rows={3}
                  placeholder={toKelas === promoAlumni ? 'Contoh: Lulus sesuai kelulusan sekolah.' : 'Contoh: Pindah sekolah (mutasi orang tua).'}
                />
                {!exitReason.trim() && (
                  <p className="text-xs text-red-500 mt-1">Alasan wajib diisi untuk keamanan audit.</p>
                )}
              </div>

              <p className="text-xs text-yellow-800">
                Sistem akan mengosongkan kelas & RFID agar tidak muncul di roster kelas aktif.
              </p>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Catatan: Kenaikan kelas boleh lintas tingkatan, misalnya X ke XI. Sistem akan memberi peringatan saat konfirmasi.
          </p>

          <div className="flex justify-end space-x-3 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={loading}>Batal</Button>
            <Button
              onClick={onConfirm}
              loading={loading}
              disabled={
                loading ||
                !toKelas ||
                (mode === 'kelas' && !fromKelas) ||
                (isExitMode && !exitReason.trim())
              }
            >
              Jalankan
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(StudentPromotionModal)
