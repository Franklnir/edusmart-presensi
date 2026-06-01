import React, { memo } from 'react'
import { formatDate } from '../../../../lib/time'
import { Button } from '../../../../pages/admin/siswa/SiswaUi'
import { calculateAgeFromIsoDate, JK_LABEL } from '../../utils/studentFormatters'
import { religionSelectOptions } from '../../../../constants/religionOptions'

function AdditionalTextInput({
  label,
  name,
  value,
  error,
  onChange,
  placeholder,
  maxLength,
  type = 'text',
  min,
  max
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${error ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
        placeholder={placeholder}
        maxLength={maxLength}
        min={min}
        max={max}
      />
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}

function StudentAdditionalInfoPanel({
  detailUser,
  canEdit,
  editing,
  saving,
  form,
  errors,
  onEdit,
  onCancel,
  onChange,
  onSave
}) {
  const calculatedAge = calculateAgeFromIsoDate(detailUser?.tanggal_lahir)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h4 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <span>-</span>
          Informasi Tambahan
        </h4>
        {canEdit && !editing && (
          <Button variant="primary" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <AdditionalTextInput
                label="Nama Siswa"
                name="nama"
                value={form.nama}
                error={errors.nama}
                onChange={onChange}
                placeholder="Masukkan nama siswa"
                maxLength={120}
              />
            </div>

            <AdditionalTextInput
              label="NIS"
              name="nis"
              value={form.nis}
              error={errors.nis}
              onChange={onChange}
              placeholder="Masukkan NIS siswa"
              maxLength={40}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Jenis Kelamin
              </label>
              <select
                name="jk"
                value={form.jk}
                onChange={onChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white"
              >
                <option value="">Pilih jenis kelamin</option>
                <option value="L">Laki-laki</option>
                <option value="P">Perempuan</option>
              </select>
            </div>

            <AdditionalTextInput
              label="Tanggal Lahir"
              type="date"
              name="tanggal_lahir"
              value={form.tanggal_lahir}
              onChange={onChange}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Agama
              </label>
              <select
                name="agama"
                value={form.agama}
                onChange={onChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white"
              >
                {religionSelectOptions(form.agama).map((option) => (
                  <option key={option.value || 'empty'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Alamat
              </label>
              <textarea
                name="alamat"
                value={form.alamat}
                onChange={onChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 min-h-[96px] resize-y"
                placeholder="Masukkan alamat siswa"
                maxLength={1000}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Batal
            </Button>
            <Button variant="success" size="sm" onClick={onSave} loading={saving}>
              Simpan
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Nama Siswa</p>
            <p className="text-sm text-gray-900">{detailUser?.nama || '-'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">NIS</p>
            <p className="text-sm text-gray-900">{detailUser?.nis || '-'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Jenis Kelamin</p>
            <p className="text-sm text-gray-900">{JK_LABEL(detailUser?.jk)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Usia</p>
            <p className="text-sm text-gray-900">{calculatedAge !== null ? `${calculatedAge} tahun` : '-'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Tanggal Lahir</p>
            <p className="text-sm text-gray-900">{formatDate(detailUser?.tanggal_lahir)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Agama</p>
            <p className="text-sm text-gray-900">{detailUser?.agama || '-'}</p>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <p className="text-sm font-medium text-gray-700">Alamat</p>
            <p className="text-sm text-gray-900">{detailUser?.alamat || '-'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(StudentAdditionalInfoPanel)
