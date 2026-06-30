import React, { memo } from 'react'

function StudentPageHeader({
  isGuru,
  canManage,
  showAddForm,
  onExport,
  onImport,
  onToggleAddForm
}) {
  return (
    <div className="page-title-card">
      <div className="page-title-layout">
        <div className="page-title-main">
          <div className="page-title-icon bg-blue-100 text-blue-600">
            <span className="text-2xl text-blue-600">👨‍🎓</span>
          </div>
          <div>
            <h1 className="page-title-heading">Manajemen Siswa</h1>
            <p className="page-title-description">
              Kelola data siswa, kelas, organisasi, OSIS, dan kartu RFID
            </p>
            {isGuru && (
              <p className="text-xs text-amber-700 mt-1">
                Mode Wali Kelas: hanya lihat data siswa. Perubahan hanya untuk kartu RFID.
              </p>
            )}
          </div>
        </div>

        {canManage && (
          <div className="mt-4 lg:mt-0 flex flex-col sm:flex-row gap-2">
            <button
              className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-all duration-200 font-medium"
              onClick={onExport}
              type="button"
            >
              ⬇️ Export
            </button>
            <button
              className="bg-amber-50 text-amber-700 px-4 py-2 rounded-lg border border-amber-200 hover:bg-amber-100 focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 transition-all duration-200 font-medium"
              onClick={onImport}
              type="button"
            >
              ⬆️ Import
            </button>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium"
              onClick={onToggleAddForm}
              type="button"
            >
              {showAddForm ? '✕ Tutup Form' : '➕ Tambah Siswa'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(StudentPageHeader)
