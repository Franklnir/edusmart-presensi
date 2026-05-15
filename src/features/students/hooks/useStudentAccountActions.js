import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'

const buildEmptyStudentForm = () => ({
  email: '',
  nama: '',
  kelas: '',
  nis: '',
  jk: '',
  password: '',
  confirmPassword: '',
})

const STRONG_PASSWORD_MESSAGE = 'Password minimal 12 karakter dan wajib ada huruf besar, huruf kecil, angka, serta simbol'
const isStrongPassword = (value = '') =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/.test(value)

export function useStudentAccountActions({
  detailUser,
  getNamaKelas,
  openPasswordModal,
  pushToast,
  reloadStudents,
  setDetailUser,
}) {
  const [form, setForm] = useState(() => buildEmptyStudentForm())
  const [formErrors, setFormErrors] = useState({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingSiswa, setAddingSiswa] = useState(false)

  const [nonaktifModalOpen, setNonaktifModalOpen] = useState(false)
  const [alasanNonaktif, setAlasanNonaktif] = useState('')
  const [siswaToNonaktif, setSiswaToNonaktif] = useState(null)

  const [mutasiModalOpen, setMutasiModalOpen] = useState(false)
  const [alasanMutasi, setAlasanMutasi] = useState('')
  const [siswaToMutasi, setSiswaToMutasi] = useState(null)
  const [mutatingSiswa, setMutatingSiswa] = useState(false)

  const [aktifkanModalOpen, setAktifkanModalOpen] = useState(false)
  const [siswaToAktifkan, setSiswaToAktifkan] = useState(null)

  const validateForm = useCallback(() => {
    const errors = {}
    if (!form.email.trim()) errors.email = 'Email harus diisi'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Format email tidak valid'

    if (!form.nama.trim()) errors.nama = 'Nama lengkap harus diisi'
    if (!form.password) errors.password = 'Password harus diisi'
    else if (!isStrongPassword(form.password)) errors.password = STRONG_PASSWORD_MESSAGE
    if (form.password !== form.confirmPassword) errors.confirmPassword = 'Password dan konfirmasi tidak sama'
    if (form.nis && !/^\d+$/.test(form.nis)) errors.nis = 'NIS harus berupa angka'

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [form])

  const handleChange = useCallback((e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setFormErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev))
  }, [])

  const resetForm = useCallback(() => {
    setForm(buildEmptyStudentForm())
    setFormErrors({})
  }, [])

  const handleAdd = useCallback(async () => {
    if (!validateForm()) return

    try {
      setAddingSiswa(true)

      const { error } = await supabase.admin.provisionUser({
        email: form.email.trim().toLowerCase(),
        nama: form.nama.trim(),
        kelas: form.kelas || '',
        nis: form.nis || '',
        jk: form.jk || '',
        password: form.password,
        role: 'siswa',
        status: 'active',
        no_hp_siswa: null,
        no_hp_wali: null,
        must_change_password: true,
        created_via: 'admin_created',
      })

      if (error) throw error

      pushToast('success', 'Siswa berhasil ditambahkan. Data akun dan profil sudah sinkron.')
      resetForm()
      setShowAddForm(false)
      reloadStudents()
    } catch (error) {
      console.error(error)
      pushToast('error', 'Gagal mendaftarkan siswa: ' + (error.message || 'Unknown error'))
    } finally {
      setAddingSiswa(false)
    }
  }, [form, pushToast, reloadStudents, resetForm, validateForm])

  const toggleAddForm = useCallback(() => {
    setShowAddForm((prev) => !prev)
  }, [])

  const closeAddForm = useCallback(() => {
    setShowAddForm(false)
  }, [])

  const openNonaktifModal = useCallback((siswa) => {
    openPasswordModal(
      'Konfirmasi Nonaktifkan Siswa',
      () => {
        setSiswaToNonaktif(siswa)
        setAlasanNonaktif('')
        setNonaktifModalOpen(true)
      }
    )
  }, [openPasswordModal])

  const closeNonaktifModal = useCallback(() => {
    setNonaktifModalOpen(false)
    setAlasanNonaktif('')
    setSiswaToNonaktif(null)
  }, [])

  const handleAlasanNonaktifChange = useCallback((value) => {
    setAlasanNonaktif(value)
  }, [])

  const openMutasiModal = useCallback((siswa) => {
    openPasswordModal(
      'Konfirmasi Mutasi Siswa',
      () => {
        setSiswaToMutasi(siswa)
        setAlasanMutasi('')
        setMutasiModalOpen(true)
      }
    )
  }, [openPasswordModal])

  const closeMutasiModal = useCallback(() => {
    setMutasiModalOpen(false)
    setAlasanMutasi('')
    setSiswaToMutasi(null)
  }, [])

  const handleAlasanMutasiChange = useCallback((value) => {
    setAlasanMutasi(value)
  }, [])

  const nonaktifkanSiswa = useCallback(() => {
    if (!siswaToNonaktif) return
    if (!alasanNonaktif.trim()) {
      pushToast('error', 'Harap masukkan alasan penonaktifan')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Nonaktifkan Siswa',
      async () => {
        try {
          const reason = alasanNonaktif.trim()
          const { data, error } = await supabase.admin.updateUserStatus(siswaToNonaktif.id, {
            role: 'siswa',
            status: 'nonaktif',
            reason,
          })

          if (error) throw error

          pushToast('success', 'Siswa berhasil dinonaktifkan')

          if (detailUser && detailUser.id === siswaToNonaktif.id) {
            setDetailUser((prev) => prev ? ({
              ...prev,
              ...(data?.profile || {}),
              status: 'nonaktif',
              alasan_nonaktif: reason,
            }) : prev)
          }

          setNonaktifModalOpen(false)
          setAlasanNonaktif('')
          setSiswaToNonaktif(null)
          reloadStudents()
        } catch (error) {
          console.error('Error nonaktifkan siswa:', error)
          pushToast('error', 'Gagal menonaktifkan siswa')
        }
      }
    )
  }, [
    alasanNonaktif,
    detailUser,
    openPasswordModal,
    pushToast,
    reloadStudents,
    setDetailUser,
    siswaToNonaktif,
  ])

  const mutasikanSiswa = useCallback(() => {
    if (!siswaToMutasi) return
    if (!alasanMutasi.trim()) {
      pushToast('error', 'Harap masukkan alasan mutasi')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Mutasi Siswa',
      async () => {
        try {
          setMutatingSiswa(true)
          const lastClassName = typeof getNamaKelas === 'function'
            ? getNamaKelas(siswaToMutasi.kelas)
            : siswaToMutasi.kelas
          const reason = `Mutasi/Pindah sekolah. Kelas terakhir: ${lastClassName || '-'}. ${alasanMutasi.trim()}`
          const { data, error } = await supabase.admin.updateUserStatus(siswaToMutasi.id, {
            role: 'siswa',
            status: 'mutasi',
            reason,
          })

          if (error) throw error

          pushToast('success', 'Siswa berhasil dimutasi. Data tetap tersimpan dan relasi aktif sudah disinkronkan.')

          if (detailUser && detailUser.id === siswaToMutasi.id) {
            setDetailUser((prev) => prev ? ({
              ...prev,
              ...(data?.profile || {}),
              status: 'mutasi',
              alasan_nonaktif: reason,
              rfid_uid: null,
              kelas: '',
            }) : prev)
          }

          setMutasiModalOpen(false)
          setAlasanMutasi('')
          setSiswaToMutasi(null)
          await reloadStudents()
        } catch (error) {
          console.error('Error mutasi siswa:', error)
          pushToast('error', 'Gagal memutasi siswa: ' + (error.message || 'Unknown error'))
        } finally {
          setMutatingSiswa(false)
        }
      }
    )
  }, [
    alasanMutasi,
    detailUser,
    getNamaKelas,
    openPasswordModal,
    pushToast,
    reloadStudents,
    setDetailUser,
    siswaToMutasi,
  ])

  const openAktifkanModal = useCallback((siswa) => {
    openPasswordModal(
      'Konfirmasi Aktifkan Siswa',
      () => {
        setSiswaToAktifkan(siswa)
        setAktifkanModalOpen(true)
      }
    )
  }, [openPasswordModal])

  const closeAktifkanModal = useCallback(() => {
    setAktifkanModalOpen(false)
    setSiswaToAktifkan(null)
  }, [])

  const aktifkanSiswa = useCallback(() => {
    if (!siswaToAktifkan) return

    openPasswordModal(
      'Konfirmasi Akhir Aktifkan Siswa',
      async () => {
        try {
          const { data, error } = await supabase.admin.updateUserStatus(siswaToAktifkan.id, {
            role: 'siswa',
            status: 'active',
          })

          if (error) throw error

          pushToast('success', 'Siswa berhasil diaktifkan')

          if (detailUser && detailUser.id === siswaToAktifkan.id) {
            setDetailUser((prev) => prev ? ({
              ...prev,
              ...(data?.profile || {}),
              status: 'active',
              alasan_nonaktif: null,
            }) : prev)
          }

          setAktifkanModalOpen(false)
          setSiswaToAktifkan(null)
          reloadStudents()
        } catch (error) {
          console.error('Error mengaktifkan siswa:', error)
          pushToast('error', 'Gagal mengaktifkan siswa')
        }
      }
    )
  }, [
    detailUser,
    openPasswordModal,
    pushToast,
    reloadStudents,
    setDetailUser,
    siswaToAktifkan,
  ])

  return {
    aktifkanModalOpen,
    aktifkanSiswa,
    addingSiswa,
    alasanMutasi,
    alasanNonaktif,
    closeAddForm,
    closeAktifkanModal,
    closeMutasiModal,
    closeNonaktifModal,
    form,
    formErrors,
    handleAdd,
    handleAlasanMutasiChange,
    handleAlasanNonaktifChange,
    handleChange,
    mutasikanSiswa,
    mutasiModalOpen,
    mutatingSiswa,
    nonaktifkanSiswa,
    nonaktifModalOpen,
    openAktifkanModal,
    openMutasiModal,
    openNonaktifModal,
    resetForm,
    showAddForm,
    siswaToAktifkan,
    siswaToMutasi,
    toggleAddForm,
  }
}
