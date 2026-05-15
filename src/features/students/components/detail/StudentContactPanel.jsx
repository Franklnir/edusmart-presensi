import React, { memo } from 'react'
import { Button } from '../../../../pages/admin/siswa/SiswaUi'
import { formatPhoneDisplay } from '../../utils/studentFormatters'

function PhoneInputField({
  label,
  name,
  value,
  error,
  onChange
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type="tel"
        name={name}
        value={value}
        onChange={onChange}
        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${error ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
        placeholder="081234567890 / 6281234567890 / 81234567890"
        maxLength={18}
      />
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        Sistem menyimpan otomatis dalam format 0xxxxxxxx.
      </p>
    </div>
  )
}

function StudentContactPanel({
  detailUser,
  canManage,
  editingPhone,
  editPhoneForm,
  phoneErrors,
  onEdit,
  onCancel,
  onChange,
  onSave
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <span>-</span>
          Informasi Kontak
        </h4>
        {canManage && !editingPhone && (
          <Button variant="primary" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>

      {editingPhone ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PhoneInputField
              label="Nomor HP Siswa"
              name="no_hp_siswa"
              value={editPhoneForm.no_hp_siswa}
              error={phoneErrors.no_hp_siswa}
              onChange={onChange}
            />
            <PhoneInputField
              label="Nomor HP Orang Tua/Wali"
              name="no_hp_wali"
              value={editPhoneForm.no_hp_wali}
              error={phoneErrors.no_hp_wali}
              onChange={onChange}
            />
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Batal
            </Button>
            <Button variant="success" size="sm" onClick={onSave}>
              Simpan
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-1">Nomor HP Siswa</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatPhoneDisplay(detailUser?.no_hp_siswa)}
            </p>
            {detailUser?.no_hp_siswa && (
              <p className="text-xs text-gray-500 mt-1">
                Tersimpan: {detailUser.no_hp_siswa}
              </p>
            )}
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-1">Nomor HP Orang Tua/Wali</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatPhoneDisplay(detailUser?.no_hp_wali)}
            </p>
            {detailUser?.no_hp_wali && (
              <p className="text-xs text-gray-500 mt-1">
                Tersimpan: {detailUser.no_hp_wali}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(StudentContactPanel)
