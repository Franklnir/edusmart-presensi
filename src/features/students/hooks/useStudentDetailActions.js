import { useCallback, useState } from 'react'
import { normalizeGender } from '../../../utils/importUtils'
import {
  buildAdditionalInfoForm,
  normalizePhoneID,
  validatePhoneNumber,
} from '../utils/studentFormatters'
import { studentService } from '../services/studentService'

const buildPhoneForm = (student = null) => ({
  no_hp_siswa: student?.no_hp_siswa || '',
  no_hp_wali: student?.no_hp_wali || '',
})

export function useStudentDetailActions({
  detailUser,
  setDetailUser,
  setSiswaRaw,
  setSiswa,
  canEditAdditionalInfo,
  pushToast,
  reloadStudents,
}) {
  const [editingPhone, setEditingPhone] = useState(false)
  const [editPhoneForm, setEditPhoneForm] = useState(() => buildPhoneForm())
  const [phoneErrors, setPhoneErrors] = useState({})
  const [editingAdditionalInfo, setEditingAdditionalInfo] = useState(false)
  const [savingAdditionalInfo, setSavingAdditionalInfo] = useState(false)
  const [editAdditionalInfoForm, setEditAdditionalInfoForm] = useState(() => buildAdditionalInfoForm())
  const [additionalInfoErrors, setAdditionalInfoErrors] = useState({})

  const prepareDetailForms = useCallback((student) => {
    setEditPhoneForm(buildPhoneForm(student))
    setEditingPhone(false)
    setPhoneErrors({})
    setEditAdditionalInfoForm(buildAdditionalInfoForm(student))
    setEditingAdditionalInfo(false)
    setSavingAdditionalInfo(false)
    setAdditionalInfoErrors({})
  }, [])

  const syncDetailForms = useCallback((student) => {
    setEditPhoneForm(buildPhoneForm(student))
    setEditAdditionalInfoForm(buildAdditionalInfoForm(student))
  }, [])

  const resetDetailForms = useCallback(() => {
    setEditPhoneForm(buildPhoneForm())
    setEditingPhone(false)
    setPhoneErrors({})
    setEditAdditionalInfoForm(buildAdditionalInfoForm())
    setEditingAdditionalInfo(false)
    setSavingAdditionalInfo(false)
    setAdditionalInfoErrors({})
  }, [])

  const handleEditPhone = useCallback(() => {
    setEditingPhone(true)
  }, [])

  const handleCancelEditPhone = useCallback(() => {
    setEditingPhone(false)
    setEditPhoneForm(buildPhoneForm(detailUser))
    setPhoneErrors({})
  }, [detailUser])

  const handlePhoneChange = useCallback((e) => {
    const { name, value } = e.target
    setEditPhoneForm((prev) => ({ ...prev, [name]: value }))
    setPhoneErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev))
  }, [])

  const handleSavePhone = useCallback(async () => {
    if (!detailUser?.id) return

    const errors = {}
    const noHpSiswaError = validatePhoneNumber(editPhoneForm.no_hp_siswa, 'HP Siswa')
    const noHpWaliError = validatePhoneNumber(editPhoneForm.no_hp_wali, 'HP Wali')

    if (noHpSiswaError) errors.no_hp_siswa = noHpSiswaError
    if (noHpWaliError) errors.no_hp_wali = noHpWaliError

    if (Object.keys(errors).length > 0) {
      setPhoneErrors(errors)
      return
    }

    const normalizedSiswa = editPhoneForm.no_hp_siswa ? normalizePhoneID(editPhoneForm.no_hp_siswa) : null
    const normalizedWali = editPhoneForm.no_hp_wali ? normalizePhoneID(editPhoneForm.no_hp_wali) : null

    try {
      await studentService.updateStudent(detailUser.id, {
        no_hp_siswa: normalizedSiswa,
        no_hp_wali: normalizedWali,
      })

      pushToast('success', 'Nomor HP berhasil diperbarui')
      setDetailUser((prev) => prev ? ({
        ...prev,
        no_hp_siswa: normalizedSiswa,
        no_hp_wali: normalizedWali,
      }) : prev)

      const patchPhone = (student) => (
        student.id === detailUser.id
          ? { ...student, no_hp_siswa: normalizedSiswa, no_hp_wali: normalizedWali }
          : student
      )
      setSiswaRaw((prev) => prev.map(patchPhone))
      setSiswa((prev) => prev.map(patchPhone))

      setEditingPhone(false)
      setPhoneErrors({})
    } catch (error) {
      console.error('Error saving phone numbers:', error)
      pushToast('error', 'Gagal menyimpan nomor HP')
    }
  }, [detailUser?.id, editPhoneForm, pushToast, setDetailUser, setSiswa, setSiswaRaw])

  const handleEditAdditionalInfo = useCallback(() => {
    setEditAdditionalInfoForm(buildAdditionalInfoForm(detailUser))
    setAdditionalInfoErrors({})
    setEditingAdditionalInfo(true)
  }, [detailUser])

  const handleCancelEditAdditionalInfo = useCallback(() => {
    setEditAdditionalInfoForm(buildAdditionalInfoForm(detailUser))
    setAdditionalInfoErrors({})
    setEditingAdditionalInfo(false)
  }, [detailUser])

  const handleAdditionalInfoChange = useCallback((e) => {
    const { name, value } = e.target

    setEditAdditionalInfoForm((prev) => ({
      ...prev,
      [name]: value,
    }))

    setAdditionalInfoErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev))
  }, [])

  const handleSaveAdditionalInfo = useCallback(async () => {
    if (!detailUser?.id || !canEditAdditionalInfo) return

    const errors = {}
    const nextName = String(editAdditionalInfoForm.nama || '').trim()
    const nextGender = normalizeGender(editAdditionalInfoForm.jk) || ''

    if (!nextName) {
      errors.nama = 'Nama siswa wajib diisi'
    }

    if (Object.keys(errors).length > 0) {
      setAdditionalInfoErrors(errors)
      return
    }

    setSavingAdditionalInfo(true)
    try {
      const payload = {
        nama: nextName,
        nis: String(editAdditionalInfoForm.nis || '').trim() || null,
        jk: nextGender || null,
        tanggal_lahir: editAdditionalInfoForm.tanggal_lahir || null,
        agama: String(editAdditionalInfoForm.agama || '').trim() || null,
        alamat: String(editAdditionalInfoForm.alamat || '').trim() || null,
      }

      const res = await studentService.updateStudent(detailUser.id, payload)
      if (res.error) throw res.error

      const updatedProfile = res.data || null
      if (!updatedProfile) {
        throw new Error('Data siswa terbaru tidak ditemukan.')
      }

      setDetailUser((prev) => prev ? ({ ...prev, ...updatedProfile }) : updatedProfile)
      setEditAdditionalInfoForm(buildAdditionalInfoForm(updatedProfile))
      setEditingAdditionalInfo(false)
      setAdditionalInfoErrors({})

      if (typeof reloadStudents === 'function') {
        await reloadStudents()
      }
      pushToast('success', 'Informasi tambahan siswa berhasil diperbarui')
    } catch (error) {
      console.error('Error saving additional info:', error)
      pushToast('error', error.message || 'Gagal menyimpan informasi tambahan siswa')
    } finally {
      setSavingAdditionalInfo(false)
    }
  }, [
    canEditAdditionalInfo,
    detailUser?.id,
    editAdditionalInfoForm,
    pushToast,
    reloadStudents,
    setDetailUser,
  ])

  return {
    additionalInfoErrors,
    editAdditionalInfoForm,
    editPhoneForm,
    editingAdditionalInfo,
    editingPhone,
    handleAdditionalInfoChange,
    handleCancelEditAdditionalInfo,
    handleCancelEditPhone,
    handleEditAdditionalInfo,
    handleEditPhone,
    handlePhoneChange,
    handleSaveAdditionalInfo,
    handleSavePhone,
    phoneErrors,
    prepareDetailForms,
    resetDetailForms,
    savingAdditionalInfo,
    syncDetailForms,
  }
}
