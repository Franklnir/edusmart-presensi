import React, { memo } from 'react'
import { Button, Card, Input, Select } from '../../../pages/admin/siswa/SiswaUi'

function StudentCreateForm({
  form,
  formErrors,
  kelasOptions,
  addingSiswa,
  onChange,
  onReset,
  onCancel,
  onSubmit
}) {
  return (
    <Card className="mb-6">
      <div className="bg-blue-50 border-b border-blue-200 p-4">
        <h3 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
          <span>➕</span>
          Tambah Siswa Baru
        </h3>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Input
            label="Email *"
            name="email"
            value={form.email}
            onChange={onChange}
            placeholder="email@sekolah.sch.id"
            type="email"
            error={formErrors.email}
            required
          />
          <Input
            label="Nama Lengkap *"
            name="nama"
            value={form.nama}
            onChange={onChange}
            placeholder="Nama lengkap siswa"
            error={formErrors.nama}
            required
          />
          <Select
            label="Kelas"
            name="kelas"
            value={form.kelas}
            onChange={onChange}
            options={[
              { value: '', label: 'Pilih kelas' },
              ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
            ]}
          />
          <Input
            label="NIS"
            name="nis"
            value={form.nis}
            onChange={onChange}
            placeholder="Nomor Induk Siswa"
            error={formErrors.nis}
          />
          <Select
            label="Jenis Kelamin"
            name="jk"
            value={form.jk}
            onChange={onChange}
            options={[
              { value: '', label: 'Pilih jenis kelamin' },
              { value: 'L', label: 'Laki-laki' },
              { value: 'P', label: 'Perempuan' }
            ]}
          />
          <Input
            label="Password *"
            name="password"
            value={form.password}
            onChange={onChange}
            placeholder="Min. 12 karakter, Aa, angka, simbol"
            type="password"
            error={formErrors.password}
            required
          />
          <Input
            label="Konfirmasi Password *"
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={onChange}
            placeholder="Ulangi password"
            type="password"
            error={formErrors.confirmPassword}
            required
          />
        </div>

        <div className="flex justify-end space-x-3 mt-4 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={onReset}>🔄 Reset</Button>
          <Button variant="secondary" onClick={onCancel}>✕ Batal</Button>
          <Button
            onClick={onSubmit}
            loading={addingSiswa}
            disabled={
              !form.email ||
              !form.nama ||
              !form.password ||
              form.password !== form.confirmPassword
            }
          >
            👨‍🎓 Daftarkan
          </Button>
        </div>
      </div>
    </Card>
  )
}

export default memo(StudentCreateForm)
