import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'

export function useStudentDetailData({
  pushToast,
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailUser, setDetailUser] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [orgMember, setOrgMember] = useState([])
  const [osisRow, setOsisRow] = useState(null)

  const openStudentDetail = useCallback(async (student, callbacks = {}) => {
    const {
      prepareDetailForms,
      prepareRfidForStudent,
      prepareClassForStudent,
      syncClassFromStudent,
      syncDetailForms,
      syncRfidFromStudent,
    } = callbacks

    prepareRfidForStudent?.(student)
    prepareClassForStudent?.(student)

    setDetailUser(student)
    prepareDetailForms?.(student)

    setDetailLoading(true)
    setDetailOpen(true)

    try {
      const { data, error } = await supabase.admin.studentDetail(student.id)
      if (error) throw error

      const detailProfile = data?.profile || null
      if (detailProfile) {
        setDetailUser((prev) => ({
          ...(prev || {}),
          ...detailProfile,
        }))
        syncClassFromStudent?.(detailProfile)
        syncDetailForms?.(detailProfile)
        syncRfidFromStudent?.(detailProfile)
      }

      setOrgMember(Array.isArray(data?.org_member) ? data.org_member : [])
      setOsisRow(data?.osis || null)
    } catch (error) {
      console.error('Error loading detail:', error)
      pushToast('error', 'Gagal memuat detail siswa')
    } finally {
      setDetailLoading(false)
    }
  }, [pushToast])

  const closeStudentDetail = useCallback((callbacks = {}) => {
    const { resetDetailForms, resetRfidSession } = callbacks

    setDetailOpen(false)
    setDetailUser(null)
    setOrgMember([])
    setOsisRow(null)
    resetRfidSession?.()
    resetDetailForms?.()
  }, [])

  const deleteStudentOrganization = useCallback(async (orgId) => {
    const user = detailUser
    if (!user) return
    if (!window.confirm('Yakin mau dihapus dari organisasi ini?')) return

    try {
      const { error } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('organisasi_id', orgId)
        .eq('siswa_id', user.id)

      if (error) throw error

      pushToast('success', 'Berhasil dihapus dari organisasi')
      setOrgMember((prev) => prev.filter((item) => item.orgId !== orgId))
    } catch (error) {
      console.error('Error deleting org:', error)
      pushToast('error', 'Gagal menghapus dari organisasi')
    }
  }, [detailUser, pushToast])

  const deleteStudentOsis = useCallback(async () => {
    const user = detailUser
    if (!user) return
    if (!window.confirm('Yakin mau dihapus dari OSIS?')) return

    try {
      const { error } = await supabase
        .from('osis_anggota')
        .delete()
        .eq('siswa_id', user.id)

      if (error) throw error

      pushToast('success', 'Berhasil dihapus dari OSIS')
      setOsisRow(null)
    } catch (error) {
      console.error('Error deleting OSIS:', error)
      pushToast('error', 'Gagal menghapus dari OSIS')
    }
  }, [detailUser, pushToast])

  return {
    closeStudentDetail,
    deleteStudentOrganization,
    deleteStudentOsis,
    detailLoading,
    detailOpen,
    detailUser,
    openStudentDetail,
    orgMember,
    osisRow,
    setDetailUser,
  }
}
