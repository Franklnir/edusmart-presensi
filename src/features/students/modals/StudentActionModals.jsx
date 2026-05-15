import React, { memo } from 'react'
import { Button } from '../../../pages/admin/siswa/SiswaUi'

function ModalShell({ tone = 'red', icon = '!', title, description, children }) {
  const toneClasses = {
    red: 'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-600',
    green: 'bg-green-100 text-green-600',
    indigo: 'bg-indigo-100 text-indigo-600'
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg ${toneClasses[tone]}`}>
            <span className="text-xl">{icon}</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="text-gray-600 text-sm">{description}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export const MutateStudentModal = memo(function MutateStudentModal({
  isOpen,
  student,
  reason,
  mutating,
  onReasonChange,
  onClose,
  onConfirm
}) {
  if (!isOpen) return null

  return (
    <ModalShell
      tone="indigo"
      icon="↗"
      title="Mutasi Siswa"
      description="Tandai siswa pindah sekolah tanpa menghapus data"
    >
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4 space-y-2">
        <p className="text-gray-800 text-sm">
          Target: <strong>{student?.nama}</strong> ({student?.email})
        </p>
        <p className="text-indigo-700 text-xs">
          Data akun dan riwayat tetap tersimpan. Kelas aktif, RFID, dan jabatan ketua kelas akan dilepas.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Alasan/Catatan Mutasi *
          </label>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Contoh: Pindah sekolah mengikuti domisili orang tua..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white resize-none"
            rows={3}
            disabled={mutating}
          />
        </div>

        <div className="flex justify-end space-x-3">
          <Button variant="secondary" onClick={onClose} disabled={mutating}>Batal</Button>
          <Button
            variant="warning"
            onClick={onConfirm}
            loading={mutating}
            disabled={!reason.trim()}
          >
            Mutasikan
          </Button>
        </div>
      </div>
    </ModalShell>
  )
})

export const DeactivateStudentModal = memo(function DeactivateStudentModal({
  isOpen,
  reason,
  onReasonChange,
  onClose,
  onConfirm
}) {
  if (!isOpen) return null

  return (
    <ModalShell
      tone="orange"
      icon="!"
      title="Nonaktifkan Siswa"
      description="Siswa tidak akan bisa login"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Alasan Penonaktifan *
          </label>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Masukkan alasan menonaktifkan siswa..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white resize-none"
            rows={3}
          />
        </div>

        <div className="flex justify-end space-x-3">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="warning"
            onClick={onConfirm}
            disabled={!reason.trim()}
          >
            Nonaktifkan
          </Button>
        </div>
      </div>
    </ModalShell>
  )
})

export const ActivateStudentModal = memo(function ActivateStudentModal({
  isOpen,
  student,
  onClose,
  onConfirm
}) {
  if (!isOpen) return null

  return (
    <ModalShell
      tone="green"
      icon="+"
      title="Aktifkan Siswa"
      description="Siswa akan bisa login kembali"
    >
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <p className="text-green-800 text-sm font-medium mb-2">
          Apakah Anda yakin ingin mengaktifkan siswa ini?
        </p>
        <p className="text-green-700 text-sm">
          <strong>{student?.nama}</strong> ({student?.email})
        </p>
      </div>

      <div className="flex justify-end space-x-3">
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button variant="success" onClick={onConfirm}>Ya, Aktifkan</Button>
      </div>
    </ModalShell>
  )
})
