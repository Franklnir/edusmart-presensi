import React, { memo } from 'react'
import { Button, Card, Input, Select } from '../../../pages/admin/siswa/SiswaUi'

const RFID_OPTIONS = [
  { value: '', label: 'Semua' },
  { value: 'yes', label: 'Sudah punya RFID' },
  { value: 'no', label: 'Belum punya RFID' }
]

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status' },
  { value: 'active', label: 'Aktif' },
  { value: 'nonaktif', label: 'Nonaktif' },
  { value: 'mutasi', label: 'Mutasi (Pindah Sekolah)' },
  { value: 'alumni', label: 'Alumni (Lulus)' }
]

function StudentFilterSection({
  qNama,
  qNIS,
  qKelas,
  qHasRfid,
  qStatus,
  isGuru,
  kelasOptions,
  kelasFilterOptions,
  isSearching,
  onNamaChange,
  onNISChange,
  onKelasChange,
  onHasRfidChange,
  onStatusChange,
  onSearch,
  onReset
}) {
  return (
    <Card>
      <div className="bg-gray-50 border-b border-gray-200 p-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span>🔍</span>
          Filter Pencarian
        </h3>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Input
            label="Nama / Email"
            placeholder="Cari nama atau email"
            value={qNama}
            onChange={onNamaChange}
          />
          <Input
            label="NIS"
            placeholder="Cari NIS"
            value={qNIS}
            onChange={onNISChange}
          />
          <Select
            label="Kelas"
            value={qKelas}
            onChange={onKelasChange}
            options={kelasFilterOptions}
            disabled={isGuru && kelasOptions.length === 1}
          />
          <Select
            label="Status RFID"
            value={qHasRfid}
            onChange={onHasRfidChange}
            options={RFID_OPTIONS}
          />
          <Select
            label="Status Akun"
            value={qStatus}
            onChange={onStatusChange}
            options={STATUS_OPTIONS}
          />
        </div>
        <div className="flex justify-end space-x-3 mt-4">
          <Button onClick={onSearch} loading={isSearching}>Cari</Button>
          <Button variant="secondary" onClick={onReset}>🔄 Reset</Button>
        </div>
      </div>
    </Card>
  )
}

export default memo(StudentFilterSection)
