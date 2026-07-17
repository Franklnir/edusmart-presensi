import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, apiFetch } from '../../../services/storageService'

export function useStudentRfidActions({
  canManageRfid,
  detailUser,
  setDetailUser,
  setSiswaRaw,
  setSiswa,
  pushToast,
}) {
  const [rfidInput, setRfidInput] = useState('')
  const [rfidEnrolling, setRfidEnrolling] = useState(false)
  const [rfidLastScan, setRfidLastScan] = useState(null)
  const rfidChannelRef = useRef(null)

  const removeRfidChannel = useCallback(() => {
    if (!rfidChannelRef.current) return

    try {
      supabase.removeChannel(rfidChannelRef.current)
    } catch {
      // Channel cleanup is best-effort. The UI state below is still reset.
    }
    rfidChannelRef.current = null
  }, [])

  const resetRfidSession = useCallback(() => {
    removeRfidChannel()
    setRfidInput('')
    setRfidLastScan(null)
    setRfidEnrolling(false)
  }, [removeRfidChannel])

  const prepareRfidForStudent = useCallback((student) => {
    removeRfidChannel()
    setRfidInput((student?.rfid_uid || '').toUpperCase())
    setRfidLastScan(null)
    setRfidEnrolling(false)
  }, [removeRfidChannel])

  const syncRfidFromStudent = useCallback((student) => {
    setRfidInput((student?.rfid_uid || '').toUpperCase())
  }, [])

  const handleRfidInputChange = useCallback((value) => {
    setRfidInput(value.toUpperCase())
  }, [])

  const toggleRfidListen = useCallback(async () => {
    if (!canManageRfid) return

    if (rfidEnrolling) {
      removeRfidChannel()
      setRfidEnrolling(false)

      try {
        await apiFetch('/api/rfid/set-mode', {
          method: 'POST',
          body: { mode: 'auto' },
        })
      } catch (err) {
        console.error('Failed to reset RFID mode:', err)
      }

      pushToast('info', 'Mode scan RFID dimatikan')
      return
    }

    try {
      const { error: modeErr } = await apiFetch('/api/rfid/set-mode', {
        method: 'POST',
        body: { mode: 'enroll' },
      })
      if (modeErr) {
        pushToast('warning', 'Gagal sinkronisasi hardware, tapi mode scan aktif.')
      }
    } catch (err) {
      console.error('Failed to set RFID mode:', err)
    }

    const channel = supabase
      .channel('rfid-scans-detail')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rfid_scans' },
        (payload) => {
          if (!payload?.new || (payload.new.status && String(payload.new.status).toLowerCase() !== 'raw')) return
          const uid = (payload.new.card_uid || '').toUpperCase().replace(/\s+/g, '')
          setRfidInput(uid)
          setRfidLastScan(payload.new)
          pushToast('success', `UID RFID terdeteksi: ${uid}`)
        }
      )
      .subscribe()

    rfidChannelRef.current = channel
    setRfidEnrolling(true)
    pushToast('info', 'Mode scan aktif. Silakan tap kartu di reader.')
  }, [canManageRfid, pushToast, removeRfidChannel, rfidEnrolling])

  const saveRfid = useCallback(async () => {
    if (!canManageRfid) return
    if (!detailUser) return

    const raw = (rfidInput || '').trim()
    const cleaned = raw.toUpperCase().replace(/\s+/g, '')

    if (!cleaned) {
      pushToast('error', 'UID RFID tidak boleh kosong')
      return
    }

    if (!/^[0-9A-F]{8,14}$/.test(cleaned)) {
      pushToast('error', 'Format UID RFID tidak valid. Harus 8-14 karakter hexadecimal (0-9, A-F)')
      return
    }

    try {
      const { data: existingRows, error: exError } = await supabase
        .from('profiles')
        .select('id, nama, email')
        .eq('rfid_uid', cleaned)
        .neq('id', detailUser.id)

      if (exError) throw exError
      if (existingRows && existingRows.length > 0) {
        const other = existingRows[0]
        pushToast(
          'error',
          `UID ${cleaned} sudah terdaftar untuk siswa:\n` +
          `${other.nama || 'Tanpa nama'} (${other.email || 'Tanpa email'})`
        )
        return
      }

      const { error } = await supabase
        .from('profiles')
        .update({ rfid_uid: cleaned })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'UID RFID berhasil disimpan')
      setDetailUser((prev) => prev ? { ...prev, rfid_uid: cleaned } : prev)
      setSiswaRaw((prev) => prev.map((student) => (
        student.id === detailUser.id ? { ...student, rfid_uid: cleaned } : student
      )))
      setSiswa((prev) => prev.map((student) => (
        student.id === detailUser.id ? { ...student, rfid_uid: cleaned } : student
      )))
    } catch (err) {
      console.error('Error saving RFID:', err)
      pushToast('error', 'Gagal menyimpan UID RFID')
    }
  }, [canManageRfid, detailUser, pushToast, rfidInput, setDetailUser, setSiswa, setSiswaRaw])

  const clearRfid = useCallback(async () => {
    if (!canManageRfid) return
    if (!detailUser) return
    if (!detailUser.rfid_uid && !rfidInput) return

    if (!window.confirm('Yakin ingin mengosongkan UID RFID untuk siswa ini?')) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ rfid_uid: null })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'UID RFID dikosongkan')
      setRfidInput('')
      setDetailUser((prev) => prev ? { ...prev, rfid_uid: null } : prev)
      setSiswaRaw((prev) => prev.map((student) => (
        student.id === detailUser.id ? { ...student, rfid_uid: null } : student
      )))
      setSiswa((prev) => prev.map((student) => (
        student.id === detailUser.id ? { ...student, rfid_uid: null } : student
      )))
    } catch (err) {
      console.error('Error clearing RFID:', err)
      pushToast('error', 'Gagal mengosongkan UID RFID')
    }
  }, [canManageRfid, detailUser, pushToast, rfidInput, setDetailUser, setSiswa, setSiswaRaw])

  useEffect(() => {
    return () => {
      removeRfidChannel()
    }
  }, [removeRfidChannel])

  return {
    clearRfid,
    handleRfidInputChange,
    prepareRfidForStudent,
    resetRfidSession,
    rfidEnrolling,
    rfidInput,
    rfidLastScan,
    saveRfid,
    syncRfidFromStudent,
    toggleRfidListen,
  }
}
