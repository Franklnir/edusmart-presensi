// src/pages/admin/ASiswa.jsx
import React, { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { queryClient, queryKeys } from '../../lib/queryClient'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { exportRowsToExcel } from '../../utils/spreadsheet'
import { useLocation } from 'react-router-dom'
import { Card, PasswordModal } from './siswa/SiswaUi'
import { verifyCurrentUserPassword as verifyPassword } from '../../services/authService'
import { useDebounce } from '../../hooks/useDebounce'
import { getProfileSourceMeta } from '../../utils/profileSource'
import {
  canonGrade,
  getGradeLabel,
  getKelasDisplayName,
} from '../../features/students/utils/studentFormatters'
import { useStudentImport } from '../../features/students/hooks/useStudentImport'
import { useStudentDetailData } from '../../features/students/hooks/useStudentDetailData'
import { useStudentDetailActions } from '../../features/students/hooks/useStudentDetailActions'
import { useStudentRfidActions } from '../../features/students/hooks/useStudentRfidActions'
import { useStudentClassActions } from '../../features/students/hooks/useStudentClassActions'
import { useStudentAccountActions } from '../../features/students/hooks/useStudentAccountActions'
import StudentPageHeader from '../../features/students/sections/StudentPageHeader'
import StudentStatsGrid from '../../features/students/sections/StudentStatsGrid'
import StudentCreateForm from '../../features/students/sections/StudentCreateForm'
import StudentFilterSection from '../../features/students/sections/StudentFilterSection'
import StudentTableSection from '../../features/students/sections/StudentTableSection'
import StudentImportModal from '../../features/students/modals/StudentImportModal'
import {
  ActivateStudentModal,
  DeactivateStudentModal,
  MutateStudentModal,
} from '../../features/students/modals/StudentActionModals'
import StudentDetailModal from '../../features/students/modals/StudentDetailModal'

const SISWA_LIST_COLUMNS = [
  'id',
  'nama',
  'email',
  'kelas',
  'role',
  'status',
  'angkatan',
  'nis',
  'jk',
  'tanggal_lahir',
  'agama',
  'alamat',
  'telp',
  'no_hp_siswa',
  'no_hp_wali',
  'rfid_uid',
  'photo_url',
  'photo_path',
  'foto_url',
  'foto',
  'alasan_nonaktif'
].join(', ')

/* =======================================================================
   MAIN COMPONENT - SISWA
======================================================================= */
export default function ASiswa() {
  const { pushToast, requestConfirmation } = useUIStore()
  const { user, profile } = useAuthStore()
  const [loadingInit, setLoadingInit] = useState(true)
  const location = useLocation()

  const role = profile?.role
  const isAdmin = role === 'admin'
  const isGuru = role === 'guru'
  const isGuruRoute = location.pathname.startsWith('/guru')
  const canManage = isAdmin && !isGuruRoute
  const canManageRfid = isAdmin || isGuru

  /* ===== Password Modal State ===== */
  const [passwordModal, setPasswordModal] = useState({
    isOpen: false,
    title: '',
    action: null,
    loading: false
  })

  // Data states
  const [loadingRows, setLoadingRows] = useState(false)
  const [siswaRaw, setSiswaRaw] = useState([])
  const [siswa, setSiswa] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [strukturKelas, setStrukturKelas] = useState({})
  const [waliKelasIds, setWaliKelasIds] = useState([])
  const [waliChecked, setWaliChecked] = useState(false)
  const [siswaMeta, setSiswaMeta] = useState({
    page: 1,
    per_page: 25,
    total: 0,
    page_count: 1,
    from: 0,
    to: 0
  })
  const [siswaServerStats, setSiswaServerStats] = useState(null)
  const isWaliBlocked = isGuru && waliChecked && !waliKelasIds.length

  // Search fields
  const [qNama, setQNama] = useState('')
  const [qNIS, setQNIS] = useState('')
  const [qKelas, setQKelas] = useState('')
  const [qHasRfid, setQHasRfid] = useState('')
  const [qStatus, setQStatus] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const debouncedQNama = useDebounce(qNama, 250)
  const debouncedQNIS = useDebounce(qNIS, 250)
  const debouncedQKelas = useDebounce(qKelas, 250)
  const debouncedQHasRfid = useDebounce(qHasRfid, 250)
  const debouncedQStatus = useDebounce(qStatus, 250)

  /* ===== Password Modal Functions ===== */
  const openPasswordModal = (title, action) => {
    setPasswordModal({
      isOpen: true,
      title,
      action,
      loading: false
    })
  }

  const handlePasswordConfirm = async (password) => {
    setPasswordModal(prev => ({ ...prev, loading: true }))
    try {
      await verifyPassword(password)
      if (passwordModal.action) {
        await passwordModal.action()
      }
      setPasswordModal({ isOpen: false, title: '', action: null, loading: false })
    } catch (error) {
      console.error('Password verification failed:', error)
      pushToast('error', error.message || 'Password salah')
      setPasswordModal(prev => ({ ...prev, loading: false }))
    }
  }

  const closePasswordModal = () => {
    setPasswordModal({ isOpen: false, title: '', action: null, loading: false })
  }

  const buildStudentRequestParams = (page = 1, overrides = {}) => ({
    page,
    per_page: 25,
    q: overrides.qNama ?? debouncedQNama,
    nis: overrides.qNIS ?? debouncedQNIS,
    kelas: overrides.qKelas ?? debouncedQKelas,
    has_rfid: overrides.qHasRfid ?? debouncedQHasRfid,
    status: overrides.qStatus ?? debouncedQStatus
  })

  const loadAllData = async (page = siswaMeta.page || 1, overrides = {}) => {
    const isInitialLoad = !siswaRaw.length && !siswaMeta.total
    const shouldIncludeContext = overrides.includeContext ?? (!kelasList.length && !waliChecked)
    const shouldIncludeStats = overrides.includeStats ?? !siswaServerStats
    try {
      if (isInitialLoad) setLoadingInit(true)
      else setLoadingRows(true)
      const params = {
        ...buildStudentRequestParams(page, overrides),
        include_context: shouldIncludeContext,
        include_stats: shouldIncludeStats
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.students(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.students(params)
          if (error?.code === 'REQUEST_ABORTED') {
            const aborted = new Error('Request aborted')
            aborted.code = 'REQUEST_ABORTED'
            throw aborted
          }
          if (error) throw error
          return data
        },
        staleTime: 10 * 1000,
      })

      const siswaRows = data?.rows || []
      const kelasRows = data?.kelas || []
      const strukturRows = data?.struktur || []
      const struktur = {}
      strukturRows.forEach(item => { struktur[item.kelas_id] = item })

      startTransition(() => {
        setSiswaRaw(siswaRows)
        setSiswa(siswaRows)
        if (Array.isArray(data?.kelas)) setKelasList(kelasRows)
        if (Array.isArray(data?.struktur)) setStrukturKelas(struktur)
        if (Array.isArray(data?.wali_kelas_ids)) {
          setWaliKelasIds(data.wali_kelas_ids)
          setWaliChecked(true)
        }
        setSiswaMeta(data?.meta || {
          page,
          per_page: 25,
          total: siswaRows.length,
          page_count: 1,
          from: siswaRows.length ? 1 : 0,
          to: siswaRows.length
        })
        if (data?.stats) setSiswaServerStats(data.stats)
      })
    } catch (error) {
      if (error?.code === 'REQUEST_ABORTED') return
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
      if (isGuru) setWaliChecked(true)
    } finally {
      if (isInitialLoad) setLoadingInit(false)
      else setLoadingRows(false)
    }
  }

  const loadSiswaRaw = async (kelasIds = waliKelasIds) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'students'] })
    await loadAllData(siswaMeta.page || 1, {
      qKelas: Array.isArray(kelasIds) && kelasIds.length === 1 ? kelasIds[0] : undefined,
      includeContext: true,
      includeStats: true
    })
  }

  const loadKelasList = async (kelasIds = []) => {
    let query = supabase
      .from('kelas')
      .select('id,nama,grade,suffix,tingkat,jurusan,wali_kelas,angkatan')

    if (Array.isArray(kelasIds) && kelasIds.length) {
      query = query.in('id', kelasIds)
    }

    const { data, error } = await query
      .order('grade', { ascending: true })
      .order('suffix', { ascending: true })

    if (error) throw error
    setKelasList(data || [])
  }

  const loadStrukturKelas = async (kelasIds = []) => {
    let query = supabase
      .from('kelas_struktur')
      .select('kelas_id,wali_guru_id,wali_guru_nama,ketua_siswa_id,ketua_siswa_nama')

    if (Array.isArray(kelasIds) && kelasIds.length) {
      query = query.in('kelas_id', kelasIds)
    }

    const { data, error } = await query

    if (error) throw error

    const struktur = {}
    data?.forEach(item => { struktur[item.kelas_id] = item })
    setStrukturKelas(struktur)
  }

  // Opsi kelas untuk Select
  const kelasOptions = useMemo(() => {
    return kelasList.map(kelas => ({
      value: kelas.id,
      label: getKelasDisplayName(kelas),
      grade: kelas.grade
    }))
  }, [kelasList])

  const kelasFilterOptions = useMemo(() => {
    const mapped = kelasOptions.map(k => ({ value: k.value, label: k.label }))

    if (isGuru) {
      if (mapped.length <= 1) return mapped
      return [{ value: '', label: 'Semua Kelas Ampuan' }, ...mapped]
    }

    return [{ value: '', label: 'Semua Kelas' }, ...mapped]
  }, [isGuru, kelasOptions])

  const kelasFilterValueSet = useMemo(
    () => new Set(kelasFilterOptions.map(opt => String(opt.value || ''))),
    [kelasFilterOptions]
  )

  const getNamaKelas = useCallback((kelasId) => {
    const kelas = kelasList.find(k => k.id === kelasId)
    return getKelasDisplayName(kelas) || kelasId || '-'
  }, [kelasList])

  const {
    availableKelasNames,
    closeImportModal,
    copyImportExampleToClipboard,
    deleteSelectedImportHistory,
    downloadImportTemplateExcel,
    handleImportFileChange,
    handleLoadSheet,
    handleRunImport,
    handleSheetUrlChange,
    importBlockingErrorMessage,
    importErrors,
    importExampleCopyText,
    importExampleRows,
    importFile,
    importHistories,
    importHistoryActionLoading,
    importHistoryDetailLoading,
    importHistoryItems,
    importHistoryLoading,
    importLoading,
    importProgress,
    importModalOpen,
    importRows,
    importSource,
    importSummary,
    loadImportHistories,
    openImportHistory,
    openImportModal,
    saveSelectedImportHistory,
    selectedImportHistory,
    sheetUrl,
    switchImportSource,
  } = useStudentImport({
    kelasList,
    userId: user?.id,
    pushToast,
    requestConfirmation,
    reloadStudents: loadSiswaRaw,
  })

  const {
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
  } = useStudentDetailData({
    pushToast,
  })

  const canEditAdditionalInfo = Boolean(
    detailUser?.id && (
      isAdmin ||
      (isGuru && detailUser?.kelas && waliKelasIds.includes(detailUser.kelas))
    )
  )

  const {
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
  } = useStudentDetailActions({
    detailUser,
    setDetailUser,
    setSiswaRaw,
    setSiswa,
    canEditAdditionalInfo,
    pushToast,
    reloadStudents: loadSiswaRaw,
  })

  const {
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
  } = useStudentRfidActions({
    canManageRfid,
    detailUser,
    setDetailUser,
    setSiswaRaw,
    setSiswa,
    pushToast,
  })

  // Cek ketua kelas
  const isKetuaKelas = (siswaId) => {
    return Object.values(strukturKelas || {}).some(
      struktur => struktur.ketua_siswa_id === siswaId
    )
  }

  const getKelasKetua = (siswaId) => {
    const struktur = Object.values(strukturKelas || {}).find(
      s => s.ketua_siswa_id === siswaId
    )
    return struktur ? getNamaKelas(struktur.kelas_id) : null
  }

  useEffect(() => {
    if (!isGuru) return

    const onlyKelas = kelasOptions.length === 1 ? (kelasOptions[0]?.value || '') : ''
    const shouldUseSingleKelas = Boolean(onlyKelas)

    if (qKelas && !kelasFilterValueSet.has(String(qKelas))) {
      setQKelas(shouldUseSingleKelas ? onlyKelas : '')
      return
    }

    if (!qKelas && shouldUseSingleKelas) {
      setQKelas(onlyKelas)
    }
  }, [isGuru, kelasOptions, kelasFilterValueSet, qKelas])

  const exportSiswaToExcel = async () => {
    try {
      const params = {
        ...buildStudentRequestParams(1),
        all: true,
        per_page: 5000
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.students(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.students(params)
          if (error) throw error
          return data
        },
        staleTime: 30 * 1000,
      })

      const exportRows = data?.rows || siswa
      const rows = exportRows.map((item, idx) => ({
        No: idx + 1,
        NIS: item.nis || '',
        Nama: item.nama || '',
        Kelas: getNamaKelas(item.kelas),
        JK: item.jk || '',
        'Tanggal Lahir': item.tanggal_lahir || '',
        Agama: item.agama || '',
        Alamat: item.alamat || '',
        'HP Siswa': item.no_hp_siswa || (item.telp || ''),
        'HP Wali': item.no_hp_wali || '',
        Email: item.email || '',
        Status: item.status || 'active',
        'Asal Data': getProfileSourceMeta(item.created_via).label
      }))

      const stamp = new Date().toISOString().slice(0, 10)
      await exportRowsToExcel({
        rows,
        sheetName: 'Siswa',
        fileName: `siswa_${stamp}.xlsx`
      })
    } catch (error) {
      console.error('Error exporting siswa:', error)
      pushToast('error', 'Gagal mengekspor data siswa')
    }
  }

  /* ===== Statistik dashboard ===== */
  const stats = useMemo(() => {
    if (siswaServerStats) return siswaServerStats

    const totalSiswa = siswaRaw.length
    const aktifSiswa = siswaRaw.filter(s => (s.status || 'active') === 'active').length
    const nonaktifOnly = siswaRaw.filter(s => s.status === 'nonaktif' || s.status === 'inactive').length
    const mutasiSiswa = siswaRaw.filter(s => s.status === 'mutasi').length
    const alumniSiswa = siswaRaw.filter(s => s.status === 'alumni').length
    const nonaktifSiswa = totalSiswa - aktifSiswa
    const ketuaKelas = siswaRaw.filter(s => isKetuaKelas(s.id)).length

    return {
      totalSiswa,
      aktifSiswa,
      nonaktifSiswa,
      nonaktifOnly,
      mutasiSiswa,
      alumniSiswa,
      ketuaKelas
    }
  }, [siswaRaw, strukturKelas, siswaServerStats])

  /* ===== Filter (debounced, fix logic) ===== */
  function applyFilter() {
    setIsSearching(true)
    loadAllData(1, { qNama, qNIS, qKelas, qHasRfid, qStatus })
      .finally(() => setIsSearching(false))
  }

  function resetFilter() {
    setQNama('')
    setQNIS('')
    if (isGuru && kelasOptions.length === 1) {
      setQKelas(kelasOptions[0]?.value || '')
    } else {
      setQKelas('')
    }
    setQHasRfid('')
    setQStatus('')
    loadAllData(1, {
      qNama: '',
      qNIS: '',
      qKelas: isGuru && kelasOptions.length === 1 ? (kelasOptions[0]?.value || '') : '',
      qHasRfid: '',
      qStatus: '',
      includeStats: true
    })
  }

  const handleNamaFilterChange = useCallback((e) => {
    setQNama(e.target.value)
  }, [])

  const handleNISFilterChange = useCallback((e) => {
    setQNIS(e.target.value)
  }, [])

  const handleKelasFilterChange = useCallback((e) => {
    setQKelas(e.target.value)
  }, [])

  const handleRfidFilterChange = useCallback((e) => {
    setQHasRfid(e.target.value)
  }, [])

  const handleStatusFilterChange = useCallback((e) => {
    setQStatus(e.target.value)
  }, [])

  useEffect(() => {
    if (!role || !user?.id) return
    setIsSearching(true)
    loadAllData(1, {
      qNama: debouncedQNama,
      qNIS: debouncedQNIS,
      qKelas: debouncedQKelas,
      qHasRfid: debouncedQHasRfid,
      qStatus: debouncedQStatus
    }).finally(() => setIsSearching(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQNama, debouncedQNIS, debouncedQKelas, debouncedQHasRfid, debouncedQStatus, role, user?.id])

  const siswaPagination = useMemo(() => ({
    items: siswa,
    total: siswaMeta.total || 0,
    startIndex: Math.max(0, (siswaMeta.from || 1) - 1),
    endIndex: siswaMeta.to || siswa.length,
    page: siswaMeta.page || 1,
    pageCount: siswaMeta.page_count || 1,
    canPreviousPage: (siswaMeta.page || 1) > 1,
    canNextPage: (siswaMeta.page || 1) < (siswaMeta.page_count || 1),
    previousPage: () => {
      const prev = Math.max(1, (siswaMeta.page || 1) - 1)
      if (prev !== siswaMeta.page) loadAllData(prev, { includeContext: false, includeStats: false })
    },
    nextPage: () => {
      const next = Math.min(siswaMeta.page_count || 1, (siswaMeta.page || 1) + 1)
      if (next !== siswaMeta.page) loadAllData(next, { includeContext: false, includeStats: false })
    },
    isLoading: loadingRows
  }), [siswa, siswaMeta, loadingRows])
  const paginatedSiswa = siswaPagination.items

  /* ===== Grade helpers ===== */
  const DEFAULT_GRADES = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const gradeLabels = useMemo(() => {
    const s = new Set(DEFAULT_GRADES)
    for (const k of kelasList) {
      const g = getGradeLabel(k.id)
      if (g) s.add(g)
    }
    const order = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
    return [...s].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }, [kelasList])

  const kelasByGrade = useCallback((g) => {
    const G = canonGrade(g)
    if (!G) return []
    return kelasList.filter(k => getGradeLabel(k.id) === G)
  }, [kelasList])

  const {
    handleMoveGradeChange,
    handleMoveKelasChange,
    kosongkanKelas,
    moveGrade,
    moveKelas,
    prepareClassForStudent,
    simpanPindahKelas,
    syncClassFromStudent,
  } = useStudentClassActions({
    detailOpen,
    detailUser,
    getGradeLabel,
    getNamaKelas,
    kelasByGrade,
    kelasList,
    pushToast,
    reloadClassStructure: loadStrukturKelas,
    reloadStudents: loadSiswaRaw,
    setDetailUser,
    strukturKelas,
  })

  /* ===== Detail modal ===== */
  const openDetail = useCallback((student) => {
    openStudentDetail(student, {
      prepareClassForStudent,
      prepareDetailForms,
      prepareRfidForStudent,
      syncClassFromStudent,
      syncDetailForms,
      syncRfidFromStudent,
    })
  }, [
    openStudentDetail,
    prepareClassForStudent,
    prepareDetailForms,
    prepareRfidForStudent,
    syncClassFromStudent,
    syncDetailForms,
    syncRfidFromStudent,
  ])

  const closeDetailModal = useCallback(() => {
    closeStudentDetail({
      resetDetailForms,
      resetRfidSession,
    })
  }, [closeStudentDetail, resetDetailForms, resetRfidSession])

  const {
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
  } = useStudentAccountActions({
    closeDetailModal,
    detailUser,
    getNamaKelas,
    openPasswordModal,
    pushToast,
    reloadStudents: loadSiswaRaw,
    setDetailUser,
  })

  /* ===========================
     Render
  ============================ */
  if (isWaliBlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <Card>
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Akses dibatasi</h2>
              <p className="text-gray-600">
                Halaman ini hanya tersedia untuk guru yang menjadi wali kelas.
              </p>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        {/* Password Modal */}
        <PasswordModal
          isOpen={passwordModal.isOpen}
          onClose={closePasswordModal}
          onConfirm={handlePasswordConfirm}
          title={passwordModal.title}
          loading={passwordModal.loading}
        />

        <StudentImportModal
          isOpen={importModalOpen}
          importSource={importSource}
          kelasList={kelasList}
          availableKelasNames={availableKelasNames}
          importHistories={importHistories}
          selectedImportHistory={selectedImportHistory}
          importHistoryItems={importHistoryItems}
          importHistoryLoading={importHistoryLoading}
          importHistoryDetailLoading={importHistoryDetailLoading}
          importHistoryActionLoading={importHistoryActionLoading}
          importExampleRows={importExampleRows}
          importExampleCopyText={importExampleCopyText}
          importFile={importFile}
          importLoading={importLoading}
          sheetUrl={sheetUrl}
          importRows={importRows}
          importErrors={importErrors}
          importBlockingErrorMessage={importBlockingErrorMessage}
          importProgress={importProgress}
          importSummary={importSummary}
          onClose={closeImportModal}
          onSwitchSource={switchImportSource}
          onRefreshHistories={loadImportHistories}
          onOpenHistory={openImportHistory}
          onSaveHistory={saveSelectedImportHistory}
          onDeleteHistory={deleteSelectedImportHistory}
          onCopyExample={copyImportExampleToClipboard}
          onDownloadTemplate={downloadImportTemplateExcel}
          onImportFileChange={handleImportFileChange}
          onSheetUrlChange={handleSheetUrlChange}
          onLoadSheet={handleLoadSheet}
          onRunImport={handleRunImport}
          getNamaKelas={getNamaKelas}
        />

        <StudentPageHeader
          isGuru={isGuru}
          canManage={canManage}
          showAddForm={showAddForm}
          onExport={exportSiswaToExcel}
          onImport={openImportModal}
          onToggleAddForm={toggleAddForm}
        />

        {/* Dashboard Statistics */}
        <StudentStatsGrid stats={stats} />

        {/* Form Tambah Siswa */}
        {canManage && showAddForm && (
          <StudentCreateForm
            form={form}
            formErrors={formErrors}
            kelasOptions={kelasOptions}
            addingSiswa={addingSiswa}
            onChange={handleChange}
            onReset={resetForm}
            onCancel={closeAddForm}
            onSubmit={handleAdd}
          />
        )}

        {/* Filter Section */}
        <StudentFilterSection
          qNama={qNama}
          qNIS={qNIS}
          qKelas={qKelas}
          qHasRfid={qHasRfid}
          qStatus={qStatus}
          isGuru={isGuru}
          kelasOptions={kelasOptions}
          kelasFilterOptions={kelasFilterOptions}
          isSearching={isSearching}
          onNamaChange={handleNamaFilterChange}
          onNISChange={handleNISFilterChange}
          onKelasChange={handleKelasFilterChange}
          onHasRfidChange={handleRfidFilterChange}
          onStatusChange={handleStatusFilterChange}
          onSearch={applyFilter}
          onReset={resetFilter}
        />

        {/* Tabel Siswa */}
        <StudentTableSection
          loadingInit={loadingInit}
          loadingRows={loadingRows}
          siswa={siswa}
          siswaRaw={siswaRaw}
          totalCount={siswaMeta.total}
          paginatedSiswa={paginatedSiswa}
          pagination={siswaPagination}
          canManage={canManage}
          isKetuaKelas={isKetuaKelas}
          getNamaKelas={getNamaKelas}
          onDetail={openDetail}
          onDeactivate={openNonaktifModal}
          onActivate={openAktifkanModal}
          onMutasi={openMutasiModal}
        />

        {canManage && (
          <>
            <MutateStudentModal
              isOpen={mutasiModalOpen}
              student={siswaToMutasi}
              reason={alasanMutasi}
              mutating={mutatingSiswa}
              onReasonChange={handleAlasanMutasiChange}
              onClose={closeMutasiModal}
              onConfirm={mutasikanSiswa}
            />
            <DeactivateStudentModal
              isOpen={nonaktifModalOpen}
              reason={alasanNonaktif}
              onReasonChange={handleAlasanNonaktifChange}
              onClose={closeNonaktifModal}
              onConfirm={nonaktifkanSiswa}
            />
            <ActivateStudentModal
              isOpen={aktifkanModalOpen}
              student={siswaToAktifkan}
              onClose={closeAktifkanModal}
              onConfirm={aktifkanSiswa}
            />
          </>
        )}

        <StudentDetailModal
          isOpen={detailOpen}
          detailUser={detailUser}
          detailLoading={detailLoading}
          canManage={canManage}
          canManageRfid={canManageRfid}
          canEditAdditionalInfo={canEditAdditionalInfo}
          isKetuaKelas={isKetuaKelas}
          getKelasKetua={getKelasKetua}
          getNamaKelas={getNamaKelas}
          gradeLabels={gradeLabels}
          moveGrade={moveGrade}
          moveKelas={moveKelas}
          kelasByGrade={kelasByGrade}
          getGradeLabel={getGradeLabel}
          getKelasDisplayName={getKelasDisplayName}
          rfidInput={rfidInput}
          rfidEnrolling={rfidEnrolling}
          rfidLastScan={rfidLastScan}
          editingPhone={editingPhone}
          editPhoneForm={editPhoneForm}
          phoneErrors={phoneErrors}
          orgMember={orgMember}
          osisRow={osisRow}
          editingAdditionalInfo={editingAdditionalInfo}
          savingAdditionalInfo={savingAdditionalInfo}
          editAdditionalInfoForm={editAdditionalInfoForm}
          additionalInfoErrors={additionalInfoErrors}
          onDeactivate={openNonaktifModal}
          onActivate={openAktifkanModal}
          onMutasi={openMutasiModal}
          onClose={closeDetailModal}
          onMoveGradeChange={handleMoveGradeChange}
          onMoveKelasChange={handleMoveKelasChange}
          onSaveClass={simpanPindahKelas}
          onClearClass={kosongkanKelas}
          onRfidInputChange={handleRfidInputChange}
          onToggleRfidListen={toggleRfidListen}
          onSaveRfid={saveRfid}
          onClearRfid={clearRfid}
          onEditPhone={handleEditPhone}
          onCancelEditPhone={handleCancelEditPhone}
          onPhoneChange={handlePhoneChange}
          onSavePhone={handleSavePhone}
          onDeleteOrg={deleteStudentOrganization}
          onDeleteOsis={deleteStudentOsis}
          onEditAdditionalInfo={handleEditAdditionalInfo}
          onCancelEditAdditionalInfo={handleCancelEditAdditionalInfo}
          onAdditionalInfoChange={handleAdditionalInfoChange}
          onSaveAdditionalInfo={handleSaveAdditionalInfo}
        />
      </div>
    </div>
  )
}
