import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

export function useStudentClassActions({
  detailOpen,
  detailUser,
  getGradeLabel,
  getNamaKelas,
  kelasByGrade,
  kelasList,
  pushToast,
  reloadClassStructure,
  reloadStudents,
  setDetailUser,
  strukturKelas,
}) {
  const [moveKelas, setMoveKelas] = useState('')
  const [moveGrade, setMoveGrade] = useState('')

  const prepareClassForStudent = useCallback((student) => {
    setMoveKelas(student?.kelas || '')
    setMoveGrade(getGradeLabel(student?.kelas || '') || '')
  }, [getGradeLabel])

  const syncClassFromStudent = useCallback((student) => {
    setMoveKelas(student?.kelas || '')
    setMoveGrade(getGradeLabel(student?.kelas || '') || '')
  }, [getGradeLabel])

  useEffect(() => {
    if (!detailOpen) return
    const currentGrade = getGradeLabel(detailUser?.kelas || '')
    if (currentGrade) return
    if (!moveGrade) return
    const opts = kelasByGrade(moveGrade)
    if (!opts.length) return
    if (!moveKelas) setMoveKelas(opts[0].id)
  }, [detailOpen, detailUser, getGradeLabel, kelasByGrade, kelasList, moveGrade, moveKelas])

  const handleMoveGradeChange = useCallback((value) => {
    setMoveGrade(value)
    setMoveKelas('')
  }, [])

  const handleMoveKelasChange = useCallback((value) => {
    setMoveKelas(value)
  }, [])

  const simpanPindahKelas = useCallback(async () => {
    const user = detailUser
    const target = moveKelas || ''
    if (!user || !target) return

    const originalGrade = getGradeLabel(user.kelas || '')
    const targetGrade = getGradeLabel(target || '')
    const isCrossGrade = originalGrade && targetGrade && originalGrade !== targetGrade

    const konfirmasi = window.confirm(
      `Yakin ingin mengubah kelas siswa?\n\n` +
      `Siswa : ${user.nama}\n` +
      `Dari   : ${getNamaKelas(user.kelas) || 'Tidak ada kelas'} (${originalGrade || '-'})\n` +
      `Ke     : ${getNamaKelas(target)} (${targetGrade || '-'})\n\n` +
      `Dampak perubahan:\n` +
      `- Data absensi SELANJUTNYA akan mengikuti kelas baru\n` +
      `- Data organisasi tetap sama\n` +
      `- Data tugas dan nilai tetap sama\n` +
      `- Status ketua kelas akan direset jika ada` +
      (isCrossGrade
        ? `\n\nPERHATIAN:\n` +
        `Ini termasuk pindah tingkatan (grade) dari ${originalGrade} ke ${targetGrade}.\n` +
        `Pastikan ini memang kenaikan kelas / perbaikan salah kelas.`
        : '')
    )

    if (!konfirmasi) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: target })
        .eq('id', user.id)

      if (error) throw error

      const strukturLama = Object.values(strukturKelas).find(
        (struktur) => struktur.ketua_siswa_id === user.id
      )

      if (strukturLama) {
        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
          .eq('kelas_id', strukturLama.kelas_id)
      }

      pushToast('success', 'Kelas berhasil diupdate')
      setDetailUser((prev) => prev ? ({ ...prev, kelas: target }) : prev)
      reloadStudents()
      reloadClassStructure()
    } catch (error) {
      console.error('Error updating kelas:', error)
      pushToast('error', 'Gagal mengupdate kelas')
    }
  }, [
    detailUser,
    getGradeLabel,
    getNamaKelas,
    moveKelas,
    pushToast,
    reloadClassStructure,
    reloadStudents,
    setDetailUser,
    strukturKelas,
  ])

  const kosongkanKelas = useCallback(async () => {
    const user = detailUser
    if (!user) return
    if (!window.confirm(`Yakin mau dikosongkan kelas untuk ${user.nama || user.email || user.id}?`)) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: '' })
        .eq('id', user.id)

      if (error) throw error

      pushToast('success', 'Kelas berhasil dikosongkan')
      setMoveKelas('')
      setDetailUser((prev) => prev ? ({ ...prev, kelas: '' }) : prev)
      reloadStudents()
    } catch (error) {
      console.error('Error clearing kelas:', error)
      pushToast('error', 'Gagal mengosongkan kelas')
    }
  }, [detailUser, pushToast, reloadStudents, setDetailUser])

  return {
    handleMoveGradeChange,
    handleMoveKelasChange,
    kosongkanKelas,
    moveGrade,
    moveKelas,
    prepareClassForStudent,
    setMoveGrade,
    setMoveKelas,
    simpanPindahKelas,
    syncClassFromStudent,
  }
}
