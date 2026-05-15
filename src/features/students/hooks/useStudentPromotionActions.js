import { useCallback, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'

export const PROMO_ALUMNI = '__ALUMNI__'
export const PROMO_MUTASI = '__MUTASI__'

const getCurrentYear = () => String(new Date().getFullYear())

export function useStudentPromotionActions({
  getGradeLabel,
  getNamaKelas,
  openPasswordModal,
  pushToast,
  reloadAllData,
  siswaRaw,
}) {
  const [promotionModalOpen, setPromotionModalOpen] = useState(false)
  const [promotionMode, setPromotionMode] = useState('kelas')
  const [promotionFromKelas, setPromotionFromKelas] = useState('')
  const [promotionToKelas, setPromotionToKelas] = useState('')
  const [promotionLoading, setPromotionLoading] = useState(false)
  const [promotionFilterGrade, setPromotionFilterGrade] = useState('')
  const [promotionFilterKelas, setPromotionFilterKelas] = useState('')
  const [promotionSelectedIds, setPromotionSelectedIds] = useState([])
  const [promotionAlumniYear, setPromotionAlumniYear] = useState(getCurrentYear)
  const [promotionExitReason, setPromotionExitReason] = useState('')

  const resetPromotionFields = useCallback(() => {
    setPromotionFromKelas('')
    setPromotionToKelas('')
    setPromotionFilterGrade('')
    setPromotionFilterKelas('')
    setPromotionSelectedIds([])
    setPromotionExitReason('')
    setPromotionAlumniYear(getCurrentYear())
  }, [])

  const promotionCandidateSiswa = useMemo(() => {
    let list = siswaRaw

    if (promotionFilterGrade) {
      list = list.filter(s => getGradeLabel(s.kelas || '') === promotionFilterGrade)
    }

    if (promotionFilterKelas) {
      list = list.filter(s => s.kelas === promotionFilterKelas)
    }

    return [...list].sort((a, b) => {
      const kelasA = getNamaKelas(a.kelas)
      const kelasB = getNamaKelas(b.kelas)
      if (kelasA !== kelasB) return kelasA.localeCompare(kelasB)
      return (a.nama || '').localeCompare(b.nama || '')
    })
  }, [getGradeLabel, getNamaKelas, promotionFilterGrade, promotionFilterKelas, siswaRaw])

  const togglePromotionSelect = useCallback((id) => {
    setPromotionSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const togglePromotionSelectAllVisible = useCallback(() => {
    const visibleIds = promotionCandidateSiswa.map(s => s.id)
    if (!visibleIds.length) return

    setPromotionSelectedIds(prev => {
      const selectedSet = new Set(prev)
      const visibleSet = new Set(visibleIds)
      const allSelected = visibleIds.every(id => selectedSet.has(id))
      if (allSelected) return prev.filter(id => !visibleSet.has(id))
      return [...new Set([...prev, ...visibleIds])]
    })
  }, [promotionCandidateSiswa])

  const openPromotionModal = useCallback(() => {
    openPasswordModal(
      'Fitur Kenaikan Kelas',
      () => {
        setPromotionMode('kelas')
        resetPromotionFields()
        setPromotionModalOpen(true)
      }
    )
  }, [openPasswordModal, resetPromotionFields])

  const closePromotionModal = useCallback(() => {
    setPromotionModalOpen(false)
    setPromotionLoading(false)
    resetPromotionFields()
  }, [resetPromotionFields])

  const handlePromotionModeChange = useCallback((value) => {
    setPromotionMode(value)
  }, [])

  const handlePromotionFromKelasChange = useCallback((value) => {
    setPromotionFromKelas(value)
  }, [])

  const handlePromotionToKelasChange = useCallback((value) => {
    setPromotionToKelas(value)
  }, [])

  const handlePromotionFilterGradeChange = useCallback((value) => {
    setPromotionFilterGrade(value)
    setPromotionFilterKelas('')
  }, [])

  const handlePromotionFilterKelasChange = useCallback((value) => {
    setPromotionFilterKelas(value)
  }, [])

  const handlePromotionAlumniYearChange = useCallback((value) => {
    setPromotionAlumniYear(value)
  }, [])

  const handlePromotionExitReasonChange = useCallback((value) => {
    setPromotionExitReason(value)
  }, [])

  const handlePromotion = useCallback(async () => {
    try {
      if (!promotionToKelas) {
        pushToast('error', 'Pilih kelas tujuan terlebih dahulu')
        return
      }

      if (promotionMode === 'kelas') {
        if (!promotionFromKelas) {
          pushToast('error', 'Pilih kelas asal terlebih dahulu')
          return
        }

        const isExit = [PROMO_ALUMNI, PROMO_MUTASI].includes(promotionToKelas)
        if (!isExit && promotionFromKelas === promotionToKelas) {
          pushToast('error', 'Kelas asal dan tujuan tidak boleh sama')
          return
        }
      } else if (!promotionSelectedIds.length) {
        pushToast('error', 'Pilih minimal 1 siswa untuk dipindahkan')
        return
      }

      let selectedSiswa = []
      let ids = []

      if (promotionMode === 'kelas') {
        selectedSiswa = siswaRaw.filter(s => s.kelas === promotionFromKelas)
        ids = selectedSiswa.map(s => s.id)
      } else {
        const selectedIdSet = new Set(promotionSelectedIds)
        selectedSiswa = siswaRaw.filter(s => selectedIdSet.has(s.id))
        ids = [...selectedIdSet]
      }

      if (!ids.length) {
        pushToast('error', 'Tidak ada siswa yang bisa diproses')
        return
      }

      const isAlumniMode = promotionToKelas === PROMO_ALUMNI
      const isMutasiMode = promotionToKelas === PROMO_MUTASI
      const isExitMode = isAlumniMode || isMutasiMode

      const fromKelasName = promotionMode === 'kelas' ? getNamaKelas(promotionFromKelas) : null
      const toKelasName = !isExitMode ? getNamaKelas(promotionToKelas) : null
      const lines = []

      if (isExitMode) {
        const modeLabel = isAlumniMode ? 'ALUMNI (Lulus)' : 'MUTASI (Pindah Sekolah)'
        lines.push(`Anda akan memproses status ${modeLabel} untuk ${ids.length} siswa.`)
        lines.push('')
        lines.push(
          promotionMode === 'kelas'
            ? `Sumber: kelas "${fromKelasName || promotionFromKelas}"`
            : 'Sumber: siswa terpilih (multi-kelas)'
        )

        if (isAlumniMode) {
          const eligible = selectedSiswa.filter(s => getGradeLabel(s.kelas) === 'XII')
          const skipped = ids.length - eligible.length
          const year = parseInt(promotionAlumniYear || '', 10) || new Date().getFullYear()

          lines.push('')
          lines.push('Alumni otomatis hanya untuk siswa kelas XII.')
          lines.push(`Eligible: ${eligible.length}${skipped ? `, dilewati: ${skipped}` : ''}`)
          lines.push(`Tahun lulus: ${year}`)
        }

        if (!promotionExitReason.trim()) {
          pushToast('error', 'Isi alasan/catatan terlebih dahulu')
          return
        }

        lines.push('')
        lines.push(`Alasan/Catatan: ${promotionExitReason.trim()}`)
        lines.push('')
        lines.push('Lanjutkan?')
      } else {
        if (promotionMode === 'kelas') {
          lines.push(
            `Anda akan memindahkan semua siswa dari kelas "${fromKelasName || promotionFromKelas}"`,
            `ke kelas "${toKelasName || promotionToKelas}".`,
            '',
            `Total siswa: ${ids.length}`
          )
        } else {
          lines.push(
            `Anda akan memindahkan ${ids.length} siswa terpilih`,
            `ke kelas "${toKelasName || promotionToKelas}".`
          )
        }

        const fromGrade =
          promotionMode === 'kelas'
            ? getGradeLabel(promotionFromKelas)
            : (() => {
              const uniqueFromGrades = [...new Set(selectedSiswa.map(s => getGradeLabel(s.kelas)).filter(Boolean))]
              return uniqueFromGrades.length === 1 ? uniqueFromGrades[0] : ''
            })()

        const toGrade = getGradeLabel(promotionToKelas)

        if (fromGrade && toGrade && fromGrade !== toGrade) {
          lines.push('')
          lines.push('PERHATIAN:')
          lines.push(`Ini termasuk pindah tingkatan (grade) dari ${fromGrade} ke ${toGrade}.`)
          lines.push('Pastikan ini memang kenaikan kelas / perbaikan salah kelas.')
        }

        lines.push('')
        lines.push('Lanjutkan?')
      }

      if (!window.confirm(lines.join('\n'))) return

      setPromotionLoading(true)
      const now = new Date().toISOString()

      if (isExitMode) {
        let eligibleSiswa = selectedSiswa
        if (isAlumniMode) {
          eligibleSiswa = selectedSiswa.filter(s => getGradeLabel(s.kelas) === 'XII')
        }

        if (!eligibleSiswa.length) {
          pushToast('error', 'Tidak ada siswa eligible untuk diproses (Alumni hanya kelas XII)')
          return
        }

        const eligibleIds = eligibleSiswa.map(s => s.id)

        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
          .in('ketua_siswa_id', eligibleIds)

        const lastClassText = promotionMode === 'kelas'
          ? (fromKelasName || promotionFromKelas)
          : 'Multi-kelas'

        let alasan = ''
        if (isAlumniMode) {
          const year = parseInt(promotionAlumniYear || '', 10) || new Date().getFullYear()
          alasan = `Lulus tahun ${year}. Kelas terakhir: ${lastClassText}.`
        } else {
          alasan = `Mutasi/Pindah sekolah. Kelas terakhir: ${lastClassText}.`
        }

        if (promotionExitReason.trim()) alasan += ` ${promotionExitReason.trim()}`

        const payload = {
          status: isAlumniMode ? 'alumni' : 'mutasi',
          disabled_at: now,
          alasan_nonaktif: alasan,
          rfid_uid: null,
          kelas: ''
        }

        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .in('id', eligibleIds)

        if (error) throw error

        const skipped = ids.length - eligibleIds.length
        pushToast('success', `${isAlumniMode ? 'Kelulusan' : 'Mutasi'} berhasil: ${eligibleIds.length} siswa`)
        if (skipped) pushToast('info', `${skipped} siswa dilewati (bukan kelas XII)`)

        closePromotionModal()
        await reloadAllData()
        return
      }

      const { error } = await supabase
        .from('profiles')
        .update({ kelas: promotionToKelas })
        .in('id', ids)

      if (error) throw error

      const affectedFrom = selectedSiswa.map(s => s.kelas).filter(Boolean)
      const affected = [...new Set([...affectedFrom, promotionToKelas].filter(Boolean))]
      if (affected.length) {
        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
          .in('kelas_id', affected)
      }

      pushToast('success', `Berhasil memindahkan ${ids.length} siswa`)
      closePromotionModal()
      await reloadAllData()
    } catch (error) {
      console.error('Error in handlePromotion:', error)
      pushToast('error', error.message || 'Gagal memproses kenaikan/pindah kelas')
    } finally {
      setPromotionLoading(false)
    }
  }, [
    closePromotionModal,
    getGradeLabel,
    getNamaKelas,
    promotionAlumniYear,
    promotionExitReason,
    promotionFromKelas,
    promotionMode,
    promotionSelectedIds,
    promotionToKelas,
    pushToast,
    reloadAllData,
    siswaRaw,
  ])

  return {
    closePromotionModal,
    handlePromotion,
    handlePromotionAlumniYearChange,
    handlePromotionExitReasonChange,
    handlePromotionFilterGradeChange,
    handlePromotionFilterKelasChange,
    handlePromotionFromKelasChange,
    handlePromotionModeChange,
    handlePromotionToKelasChange,
    openPromotionModal,
    promoAlumni: PROMO_ALUMNI,
    promoMutasi: PROMO_MUTASI,
    promotionAlumniYear,
    promotionCandidateSiswa,
    promotionExitReason,
    promotionFilterGrade,
    promotionFilterKelas,
    promotionFromKelas,
    promotionLoading,
    promotionModalOpen,
    promotionMode,
    promotionSelectedIds,
    promotionToKelas,
    togglePromotionSelect,
    togglePromotionSelectAllVisible,
  }
}
