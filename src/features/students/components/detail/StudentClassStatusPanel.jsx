import React, { memo } from 'react'
import { Button, Select } from '../../../../pages/admin/siswa/SiswaUi'
import { STATUS_META } from '../../utils/studentFormatters'

function StudentClassStatusPanel({
  detailUser,
  canManage,
  moveGrade,
  moveKelas,
  gradeLabels,
  onMoveGradeChange,
  onMoveKelasChange,
  onSaveClass,
  onClearClass,
  getGradeLabel,
  getKelasDisplayName,
  getNamaKelas,
  kelasByGrade
}) {
  const classOptions = (() => {
    const baseGrade = getGradeLabel(detailUser?.kelas || '') || moveGrade
    const options = kelasByGrade(baseGrade)

    if (!baseGrade) return [{ value: '', label: 'Pilih tingkatan dulu' }]
    if (options.length === 0) return [{ value: '', label: 'Tidak ada kelas pada tingkatan ini' }]

    return [
      { value: '', label: 'Pilih kelas' },
      ...options.map(k => ({ value: k.id, label: getKelasDisplayName(k) }))
    ]
  })()

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span>-</span>
        Kelas & Status
      </h4>
      {!canManage && (
        <div className="mb-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          Wali kelas hanya bisa mengubah informasi tambahan siswa. Perubahan kelas dan status tetap dinonaktifkan.
        </div>
      )}
      <div className="space-y-3">
        {canManage ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Tingkatan"
              value={moveGrade}
              onChange={e => onMoveGradeChange(e.target.value)}
              disabled={!canManage}
              options={[
                { value: '', label: 'Pilih tingkatan' },
                ...gradeLabels.map(g => ({ value: g, label: g }))
              ]}
            />
            <Select
              label="Kelas"
              value={moveKelas}
              onChange={e => onMoveKelasChange(e.target.value)}
              disabled={!canManage}
              options={classOptions}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Tingkatan</p>
              <p className="text-sm font-semibold text-gray-900">
                {getGradeLabel(detailUser?.kelas || '') || '-'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Kelas</p>
              <p className="text-sm font-semibold text-gray-900">
                {getNamaKelas(detailUser?.kelas) || '-'}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t">
          <div className="text-sm">
            <span className="text-gray-600">Status: </span>
            <span className={detailUser?.status && detailUser.status !== 'active' ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
              {STATUS_META(detailUser?.status || 'active').label}
            </span>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button onClick={onSaveClass} disabled={!moveKelas || moveKelas === detailUser?.kelas} size="sm">
                Simpan
              </Button>
              <Button variant="secondary" onClick={onClearClass} size="sm">
                Kosongkan
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(StudentClassStatusPanel)
