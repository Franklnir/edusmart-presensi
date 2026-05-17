import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QUIZ_MEDIA_BUCKET, supabase } from '../../lib/supabase'
import { startTransition } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import ProfileAvatar from '../../components/ProfileAvatar'
import FilePreviewModal from '../../components/FilePreviewModal'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'

import {
  POINT_OPTIONS,
  QUIZ_MAX_POINTS,
  QUIZ_IMAGE_MAX_BYTES,
  QUIZ_IMAGE_ALLOWED_EXT,
  QUIZ_IMAGE_ALLOWED_MIME,
  MONTH_FILTER_ALL,
  MONTH_FILTER_THIS,
  makeId,
  normalizeMapel,
  toBoolean,
  getFileExtension,
  isSupportedQuizImage,
  formatBytesLabel,
  safeDate,
  toMinuteDate,
  getNowLocalInput,
  toLocalInput,
  formatRemaining,
  formatDurationText,
  normalizeMode,
  getModeLabel,
  normalizeQuestionType,
  normalizeQuestionNumbering,
  getQuestionTypeLabel,
  getQuizEndAt,
  getRemainingSeconds,
  getQuizStatus,
  getQuizCreatedAtMs,
  compareQuizByDeadlineUrgency,
  sortQuizzesByPriority,
  getQuizCountdownMeta,
  getQuizMutationMeta,
  getQuizMonthKey,
  getMonthKeyFromDate,
  formatQuizMonthLabel,
  getViolationTypeLabel,
  getViolationWarningNumber,
  getViolationIncidentKey,
  isCountedViolationType,
  ONLINE_ACTIVE_SECONDS,
} from './quiz/quizUtils'

const ATTEMPT_LIMIT_OPTIONS = [
  { value: '', label: 'Tanpa batas' },
  { value: '1', label: '1 kali' },
  { value: '2', label: '2 kali' },
  { value: '3', label: '3 kali' },
  { value: '5', label: '5 kali' },
  { value: '10', label: '10 kali' },
  { value: '20', label: '20 kali' }
]

const ACCESS_DEVICE_OPTIONS = [
  { value: 'both', label: 'Web & Mobile', help: 'Siswa bisa mengerjakan dari browser atau aplikasi mobile.' },
  { value: 'web', label: 'Web saja', help: 'Siswa hanya bisa mengerjakan dari browser/web.' },
  { value: 'mobile', label: 'Mobile saja', help: 'Siswa hanya bisa mengerjakan dari aplikasi mobile.' }
]

const normalizeAccessDevice = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'web') return 'web'
  if (raw === 'mobile' || raw === 'mobile_app' || raw === 'app') return 'mobile'
  return 'both'
}

const getAccessDeviceLabel = (value) => (
  ACCESS_DEVICE_OPTIONS.find((option) => option.value === normalizeAccessDevice(value))?.label || 'Web & Mobile'
)

export default function GuruQuiz() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()
  const {
    activeAcademicPeriod,
    period,
    periodFilter,
    academicYearOptions,
    semesterOptions,
    setAcademicYear,
    setSemester,
    resetToActivePeriod,
    applyPeriodFilters,
    activeAcademicPeriodPayload
  } = useActiveAcademicPeriod()

  const [jadwal, setJadwal] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [selectedKelas, setSelectedKelas] = useState('')
  const [mapelList, setMapelList] = useState([])
  const [selectedMapel, setSelectedMapel] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')

  const [quizList, setQuizList] = useState([])
  const [quizStatsById, setQuizStatsById] = useState({})
  const [selectedQuizId, setSelectedQuizId] = useState('')
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [participants, setParticipants] = useState([])
  const [retakeLogs, setRetakeLogs] = useState([])
  const [violationLogs, setViolationLogs] = useState([])
  const [presenceByStudent, setPresenceByStudent] = useState({})
  const [essayProgressBySubmission, setEssayProgressBySubmission] = useState({})
  const [nowTick, setNowTick] = useState(() => new Date())
  const [quizRealtimeTick, setQuizRealtimeTick] = useState(0)
  const [detailRealtimeTick, setDetailRealtimeTick] = useState(0)

  const selectedQuizIdRef = useRef('')
  const trackedQuizIdsRef = useRef(new Set())
  const trackedStudentIdsRef = useRef(new Set())
  const trackedQuestionIdsRef = useRef(new Set())
  const trackedSubmissionIdsRef = useRef(new Set())
  const quizReloadTimerRef = useRef(null)
  const detailReloadTimerRef = useRef(null)

  const [showQuizForm, setShowQuizForm] = useState(false)
  const [editingQuizId, setEditingQuizId] = useState('')
  const [quizForm, setQuizForm] = useState({
    nama: '',
    mode: 'regular'
  })
  const [scheduleForm, setScheduleForm] = useState({
    starts_at: '',
    deadline_at: '',
    duration_minutes: 60
  })

  const [showQuestionForm, setShowQuestionForm] = useState(false)
  const [showStudentPreview, setShowStudentPreview] = useState(false)
  const [previewMediaUrl, setPreviewMediaUrl] = useState('')
  const [previewQuestionIndex, setPreviewQuestionIndex] = useState(0)
  const [teacherQuestionIndex, setTeacherQuestionIndex] = useState(0)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [questionForm, setQuestionForm] = useState({
    question_type: 'mcq',
    soal: '',
    image_path: '',
    poin: 10,
    options: { A: '', B: '', C: '', D: '' },
    option_images: { A: '', B: '', C: '', D: '' },
    correct: 'A'
  })
  const [detailStudent, setDetailStudent] = useState(null)
  const [detailSubmission, setDetailSubmission] = useState(null)
  const [detailAnswers, setDetailAnswers] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailActiveQuestionIndex, setDetailActiveQuestionIndex] = useState(0)
  const [essayScoreDraft, setEssayScoreDraft] = useState({})
  const [essaySavingQuestionId, setEssaySavingQuestionId] = useState('')
  const [detailFinishingReview, setDetailFinishingReview] = useState(false)
  const [retakeRestoreStudentId, setRetakeRestoreStudentId] = useState('')
  const [resultVisibilitySaving, setResultVisibilitySaving] = useState(false)
  const [securitySaving, setSecuritySaving] = useState(false)
  const [closingQuiz, setClosingQuiz] = useState(false)
  const [securityForm, setSecurityForm] = useState({
    shuffle_questions: false,
    shuffle_options: false,
    max_attempts: '',
    access_code: '',
    security_mode: 'standard',
    access_device: 'both'
  })
  const [questionImageUploading, setQuestionImageUploading] = useState(false)
  const [optionImageUploading, setOptionImageUploading] = useState({})
  const [imageSizeByPath, setImageSizeByPath] = useState({})
  const [imageSizeLoadingByPath, setImageSizeLoadingByPath] = useState({})
  const imageSizeByPathRef = useRef({})
  const imageSizeLoadingRef = useRef(new Set())

  const orderedQuizList = useMemo(() => (
    sortQuizzesByPriority(quizList, nowTick)
  ), [quizList, nowTick])

  const monthOptions = useMemo(() => (
    (period.months || []).map((month) => month.value)
  ), [period.months])

  const currentMonthKey = useMemo(() => (
    getMonthKeyFromDate(nowTick)
  ), [nowTick])

  const filteredQuizList = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) {
      return orderedQuizList.filter((quiz) => getQuizMonthKey(quiz) === currentMonthKey)
    }
    if (!selectedMonth) return orderedQuizList
    return orderedQuizList.filter((quiz) => getQuizMonthKey(quiz) === selectedMonth)
  }, [orderedQuizList, selectedMonth, currentMonthKey])

  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) return `Bulan ini (${formatQuizMonthLabel(currentMonthKey)})`
    if (!selectedMonth) return 'Semua bulan periode'
    return formatQuizMonthLabel(selectedMonth)
  }, [selectedMonth, currentMonthKey])

  const selectedQuiz = filteredQuizList.find((q) => q.id === selectedQuizId) || null

  const selectedStats = selectedQuiz ? quizStatsById[selectedQuiz.id] || null : null
  const totalStudents = selectedStats?.total_students ?? participants.length
  const joinedCount = selectedStats?.started_count ?? participants.filter((p) => p.submission?.started_at).length
  const notStartedCount = Math.max(0, totalStudents - joinedCount)
  const selectedEssayQuestionCount = Number(selectedStats?.essay_question_count || 0)
  const selectedEssayStudentPendingCount = Number(selectedStats?.essay_student_pending_count || 0)
  const selectedEssayStudentGradedCount = Number(selectedStats?.essay_student_graded_count || 0)
  const detailReviewCompletedAt = detailSubmission?.essay_review_completed_at || null
  const previewQuestion = questions[previewQuestionIndex] || null
  const teacherQuestion = questions[teacherQuestionIndex] || null
  const editingQuestionDisplayNumber = useMemo(() => {
    if (!editingQuestion?.id) return questions.length + 1
    const index = questions.findIndex((question) => question.id === editingQuestion.id)
    return index >= 0 ? index + 1 : Number(editingQuestion.nomor || 1)
  }, [editingQuestion?.id, editingQuestion?.nomor, questions])
  const attemptedStudents = useMemo(() => (
    participants
      .filter((p) => p.submission?.started_at)
      .sort((a, b) => {
        const aScore = a.submission?.score
        const bScore = b.submission?.score
        if (aScore == null && bScore != null) return 1
        if (aScore != null && bScore == null) return -1
        if (aScore != null && bScore != null && aScore !== bScore) return aScore - bScore
        return (a.nama || '').localeCompare(b.nama || '', 'id')
      })
  ), [participants])
  const ongoingStudents = useMemo(() => (
    attemptedStudents.filter((p) => p.submission?.status !== 'finished')
  ), [attemptedStudents])
  const ongoingOnlineCount = useMemo(() => (
    ongoingStudents.filter((p) => Boolean(presenceByStudent[p.id]?.online)).length
  ), [ongoingStudents, presenceByStudent])
  const activeWorkingStudents = useMemo(() => (
    ongoingStudents
      .map((student) => ({
        ...student,
        presence: presenceByStudent[student.id] || null
      }))
      .sort((a, b) => {
        const aOnline = Boolean(a.presence?.online)
        const bOnline = Boolean(b.presence?.online)
        if (aOnline !== bOnline) return aOnline ? -1 : 1
        return (a.nama || '').localeCompare(b.nama || '', 'id')
      })
  ), [ongoingStudents, presenceByStudent])
  const quizContentLocked = activeWorkingStudents.length > 0
  const quizContentLockMessage = quizContentLocked
    ? `Soal dan pengaturan non-waktu dikunci karena ${activeWorkingStudents.length} siswa masih mengerjakan quiz.`
    : ''
  const selectedQuizHasSubmissions = useMemo(() => (
    (participants || []).some((student) => Boolean(student?.submission?.id))
  ), [participants])
  const canChangeSelectedQuizMode = Boolean(
    selectedQuiz
    && !toBoolean(selectedQuiz.is_active)
    && !selectedQuizHasSubmissions
  )
  const hasEssayQuestions = useMemo(() => (
    (questions || []).some((q) => normalizeQuestionType(q?.question_type) === 'essay')
  ), [questions])
  const notStartedStudents = useMemo(() => (
    participants
      .filter((p) => !p.submission?.started_at)
      .sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'))
  ), [participants])
  const latestRetakeByStudent = useMemo(() => {
    const map = {}
    ;(retakeLogs || []).forEach((row) => {
      if (!row?.siswa_id) return
      if (!map[row.siswa_id]) {
        map[row.siswa_id] = row
        return
      }
      const prev = safeDate(map[row.siswa_id].created_at)
      const curr = safeDate(row.created_at)
      if (!prev || (curr && curr > prev)) {
        map[row.siswa_id] = row
      }
    })
    return map
  }, [retakeLogs])
  const participantById = useMemo(() => {
    const map = {}
    ;(participants || []).forEach((p) => {
      if (!p?.id) return
      map[p.id] = p
    })
    return map
  }, [participants])
  const totalQuestionPoints = useMemo(() => (
    (questions || []).reduce((sum, q) => sum + Number(q?.poin || 0), 0)
  ), [questions])
  const periodBounds = useMemo(() => {
    const start = safeDate(period.startsAt ? `${period.startsAt}T00:00:00` : null)
    const end = safeDate(period.endsAt ? `${period.endsAt}T23:59:59` : null)
    return { start, end }
  }, [period.startsAt, period.endsAt])
  const periodRangeLabel = useMemo(() => {
    if (!periodBounds.start || !periodBounds.end) return activeAcademicPeriod.tahunAjaran
    return `${formatDateTime(periodBounds.start)} - ${formatDateTime(periodBounds.end)}`
  }, [activeAcademicPeriod.tahunAjaran, periodBounds.end, periodBounds.start])
  const projectedQuestionPoints = useMemo(() => {
    const current = totalQuestionPoints
    const draft = Number(questionForm?.poin || 0)
    if (editingQuestion?.id) {
      return current - Number(editingQuestion?.poin || 0) + draft
    }
    return current + draft
  }, [totalQuestionPoints, questionForm?.poin, editingQuestion?.id, editingQuestion?.poin])

  useEffect(() => {
    if (!selectedMonth) return
    if (selectedMonth === MONTH_FILTER_THIS) return
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth('')
    }
  }, [selectedMonth, monthOptions])

  const normalizeQuizMediaPath = useCallback((value) => {
    const rawValue = String(value || '').trim()
    if (!rawValue) return ''

    let path = rawValue
    if (/^https?:\/\//i.test(rawValue) || /^\/?api\/storage\/object\?/i.test(rawValue)) {
      try {
        const baseOrigin = typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost'
        const parsed = new URL(rawValue, baseOrigin)
        const queryPath = parsed.searchParams.get('path')
        if (queryPath) {
          path = queryPath
        }
      } catch {
        path = rawValue
      }
    }

    path = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
    const prefixes = [
      'storage/app/private/quiz-media/',
      'app/private/quiz-media/',
      'private/quiz-media/'
    ]
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length)
      }
    }
    return path
  }, [])

  const getQuizImageUrl = useCallback((value) => {
    const objectPath = normalizeQuizMediaPath(value)
    if (!objectPath) return ''
    return supabase.storage.from(QUIZ_MEDIA_BUCKET).getPublicUrl(objectPath)?.data?.publicUrl || ''
  }, [normalizeQuizMediaPath])

  const setImageSizeValue = useCallback((pathValue, bytesValue) => {
    const key = String(pathValue || '').trim()
    const bytes = Number(bytesValue || 0)
    if (!key || !Number.isFinite(bytes) || bytes <= 0) return
    if (imageSizeByPathRef.current[key] === bytes) return
    imageSizeByPathRef.current = {
      ...imageSizeByPathRef.current,
      [key]: bytes
    }
    setImageSizeByPath((prev) => (prev[key] === bytes ? prev : { ...prev, [key]: bytes }))
  }, [])

  const setImageSizeLoading = useCallback((pathValue, loading) => {
    const key = String(pathValue || '').trim()
    if (!key) return
    setImageSizeLoadingByPath((prev) => {
      const next = { ...prev }
      if (loading) {
        next[key] = true
      } else {
        delete next[key]
      }
      return next
    })
  }, [])

  const ensureQuizImageSize = useCallback(async (pathValue, hintBytes = null) => {
    const key = String(pathValue || '').trim()
    if (!key) return

    const hinted = Number(hintBytes || 0)
    if (Number.isFinite(hinted) && hinted > 0) {
      setImageSizeValue(key, hinted)
      return
    }

    if (imageSizeByPathRef.current[key]) return
    if (imageSizeLoadingRef.current.has(key)) return

    const imageUrl = getQuizImageUrl(key)
    if (!imageUrl) return

    imageSizeLoadingRef.current.add(key)
    setImageSizeLoading(key, true)
    try {
      const response = await fetch(imageUrl, { credentials: 'include' })
      if (!response.ok) return
      const blob = await response.blob()
      setImageSizeValue(key, Number(blob.size || 0))
    } catch {
      // Abaikan error baca ukuran agar UI tetap responsif.
    } finally {
      imageSizeLoadingRef.current.delete(key)
      setImageSizeLoading(key, false)
    }
  }, [getQuizImageUrl, setImageSizeLoading, setImageSizeValue])

  const getQuizImageSizeLabel = useCallback((pathValue) => {
    const key = String(pathValue || '').trim()
    if (!key) return '-'
    const bytes = Number(imageSizeByPath[key] || 0)
    if (Number.isFinite(bytes) && bytes > 0) {
      return formatBytesLabel(bytes)
    }
    if (imageSizeLoadingByPath[key]) {
      return 'menghitung...'
    }
    return '-'
  }, [imageSizeByPath, imageSizeLoadingByPath])

  const removeQuizImageIfExists = useCallback(async (value) => {
    const objectPath = normalizeQuizMediaPath(value)
    if (!objectPath) return
    try {
      await supabase.storage.from(QUIZ_MEDIA_BUCKET).remove([objectPath])
    } catch {
      // Abaikan error hapus file agar flow form tidak terganggu.
    }
  }, [normalizeQuizMediaPath])

  const uploadQuizImage = useCallback(async (file, scope = 'question') => {
    if (!user?.id || !selectedQuizId) {
      throw new Error('Quiz belum dipilih')
    }
    if (!file) {
      throw new Error('Pilih file gambar terlebih dahulu')
    }
    if (!isSupportedQuizImage(file)) {
      throw new Error('Format gambar wajib JPG/PNG')
    }

    const extRaw = getFileExtension(file.name || '') || 'jpg'
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw
    const objectPath = `quiz-media/${user.id}/${selectedQuizId}/${scope}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${ext}`
    const { data, error } = await supabase.storage
      .from(QUIZ_MEDIA_BUCKET)
      .upload(objectPath, file, { upsert: true })

    if (error) {
      throw new Error(error?.message || 'Gagal upload gambar')
    }

    const path = data?.path || objectPath
    const uploadedSizeBytes = Number(data?.uploadedSizeBytes || file?.size || 0)
    const uploadedSizeLabel = data?.uploadedSizeLabel || formatBytesLabel(uploadedSizeBytes)
    return {
      path,
      uploadedSizeBytes,
      uploadedSizeLabel
    }
  }, [selectedQuizId, user?.id])

  useEffect(() => {
    setPreviewQuestionIndex((prev) => {
      if (!questions.length) return 0
      if (prev < 0) return 0
      if (prev > questions.length - 1) return questions.length - 1
      return prev
    })
  }, [questions.length])

  useEffect(() => {
    setTeacherQuestionIndex((prev) => {
      if (!questions.length) return 0
      if (prev < 0) return 0
      if (prev > questions.length - 1) return questions.length - 1
      return prev
    })
  }, [questions.length])

  useEffect(() => {
    setTeacherQuestionIndex(0)
  }, [selectedQuizId])

  useEffect(() => {
    const pending = new Set()
    ;(questions || []).forEach((question) => {
      if (question?.image_path) pending.add(question.image_path)
      ;(optionsByQuestion[question.id] || []).forEach((opt) => {
        if (opt?.image_path) pending.add(opt.image_path)
      })
    })
    if (questionForm?.image_path) pending.add(questionForm.image_path)
    Object.values(questionForm?.option_images || {}).forEach((value) => {
      if (value) pending.add(value)
    })
    ;(detailAnswers || []).forEach((row) => {
      if (row?.questionImagePath) pending.add(row.questionImagePath)
      ;(row?.options || []).forEach((opt) => {
        if (opt?.image_path) pending.add(opt.image_path)
      })
    })

    pending.forEach((value) => {
      void ensureQuizImageSize(value)
    })
  }, [questions, optionsByQuestion, questionForm?.image_path, questionForm?.option_images, detailAnswers, ensureQuizImageSize])

  useEffect(() => {
    selectedQuizIdRef.current = selectedQuizId || ''
  }, [selectedQuizId])

  useEffect(() => {
    trackedQuizIdsRef.current = new Set((quizList || []).map((q) => q.id).filter(Boolean))
  }, [quizList])

  useEffect(() => {
    trackedStudentIdsRef.current = new Set((participants || []).map((p) => p.id).filter(Boolean))
  }, [participants])

  useEffect(() => {
    trackedQuestionIdsRef.current = new Set((questions || []).map((q) => q.id).filter(Boolean))
  }, [questions])

  useEffect(() => {
    trackedSubmissionIdsRef.current = new Set(
      (participants || []).map((p) => p?.submission?.id).filter(Boolean)
    )
  }, [participants])

  const queueQuizReload = useCallback((delay = 120) => {
    if (quizReloadTimerRef.current) {
      clearTimeout(quizReloadTimerRef.current)
    }
    quizReloadTimerRef.current = setTimeout(() => {
      quizReloadTimerRef.current = null
      setQuizRealtimeTick((prev) => prev + 1)
    }, delay)
  }, [])

  const queueDetailReload = useCallback((delay = 120) => {
    if (detailReloadTimerRef.current) {
      clearTimeout(detailReloadTimerRef.current)
    }
    detailReloadTimerRef.current = setTimeout(() => {
      detailReloadTimerRef.current = null
      setDetailRealtimeTick((prev) => prev + 1)
    }, delay)
  }, [])

  useEffect(() => {
    return () => {
      if (quizReloadTimerRef.current) clearTimeout(quizReloadTimerRef.current)
      if (detailReloadTimerRef.current) clearTimeout(detailReloadTimerRef.current)
    }
  }, [])
  const violationSummaryBySubmission = useMemo(() => {
    const map = {}
    ;(violationLogs || []).forEach((row) => {
      const submissionId = row?.submission_id
      if (!submissionId) return
      if (!map[submissionId]) {
        map[submissionId] = {
          count: 0,
          maxWarningCount: 0,
          incidentKeys: new Set(),
          lastAt: null,
          lastType: '',
          lastMessage: ''
        }
      }

      const current = map[submissionId]
      const warningNumber = getViolationWarningNumber(row)
      if (warningNumber > current.maxWarningCount) {
        current.maxWarningCount = warningNumber
      }
      if (isCountedViolationType(row?.event_type)) {
        current.incidentKeys.add(getViolationIncidentKey(row))
      }
      const prevDate = safeDate(current.lastAt)
      const rowDate = safeDate(row?.created_at)
      if (!prevDate || (rowDate && rowDate > prevDate)) {
        current.lastAt = row?.created_at || null
        current.lastType = row?.event_type || ''
        current.lastMessage = row?.event_message || ''
      }
    })

    Object.values(map).forEach((summary) => {
      summary.count = Math.max(summary.maxWarningCount || 0, summary.incidentKeys?.size || 0)
      delete summary.maxWarningCount
      delete summary.incidentKeys
    })
    return map
  }, [violationLogs])
  const detailEssayPendingCount = useMemo(() => (
    (detailAnswers || []).filter((row) => {
      if (row.questionType !== 'essay') return false
      const answerText = String(row.essayAnswer || '').trim()
      if (!answerText) return false
      return row.essayScore == null
    }).length
  ), [detailAnswers])
  const detailActiveAnswer = detailAnswers[detailActiveQuestionIndex] || null

  const isDetailQuestionAnswered = useCallback((row) => {
    if (!row) return false
    if (row.questionType === 'essay') {
      return String(row.essayAnswer || '').trim() !== ''
    }
    return Boolean(row.selectedOptionId)
  }, [])

  useEffect(() => {
    setDetailActiveQuestionIndex((prev) => {
      if (!detailAnswers.length) return 0
      if (prev < 0) return 0
      if (prev > detailAnswers.length - 1) return detailAnswers.length - 1
      return prev
    })
  }, [detailAnswers.length])

  useEffect(() => {
    const loadJadwal = async () => {
      if (!user?.id) return
      try {
        let query = supabase.from('jadwal').select('*').eq('guru_id', user.id)
        query = applyPeriodFilters(query)
        const { data } = await query
        setJadwal(data || [])
      } catch (err) {
        console.error(err)
      }
    }
    loadJadwal()
  }, [applyPeriodFilters, user?.id])

  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const loadKelas = async () => {
      if (!jadwal.length) {
        setKelasList([])
        setSelectedKelas('')
        return
      }
      const kelasIds = [...new Set(jadwal.map((j) => j.kelas_id).filter(Boolean))]
      if (!kelasIds.length) {
        setKelasList([])
        return
      }
      const { data } = await supabase.from('kelas').select('*').in('id', kelasIds).order('grade').order('suffix')
      setKelasList(data || [])
      if (!selectedKelas && data?.length) setSelectedKelas(data[0].id)
    }
    loadKelas()
  }, [jadwal, selectedKelas])

  useEffect(() => {
    if (!selectedKelas) {
      setMapelList([])
      setSelectedMapel('')
      return
    }
    const mapels = jadwal
      .filter((j) => j.kelas_id === selectedKelas && j.mapel)
      .map((j) => normalizeMapel(j.mapel))
      .filter((v, i, s) => v && s.indexOf(v) === i)
      .sort()
    setMapelList(mapels)
    if (!selectedMapel && mapels.length) setSelectedMapel(mapels[0])
  }, [selectedKelas, jadwal, selectedMapel])

  const loadQuizzes = async () => {
    if (!selectedKelas || !selectedMapel) {
      setQuizList([])
      setQuizStatsById({})
      setSelectedQuizId('')
      return
    }
    const { data, error } = await supabase.quiz.dashboard({
      page: 1,
      per_page: 100,
      kelas: selectedKelas,
      mapel: selectedMapel,
      tahun_ajaran: period.tahunAjaran,
      semester: period.semester
    })
    if (error?.code === 'REQUEST_ABORTED') return
    if (error) throw error

    const rows = data?.rows || []
    const summary = {}
    rows.forEach((quiz) => {
      summary[quiz.id] = quiz.stats || {
        total_students: 0,
        started_count: 0,
        ongoing_count: 0,
        finished_count: 0,
        not_started_count: 0,
        essay_question_count: 0,
        essay_answered_count: 0,
        essay_graded_count: 0,
        essay_pending_count: 0,
        essay_student_graded_count: 0,
        essay_student_pending_count: 0
      }
    })

    startTransition(() => {
      setQuizList(rows)
      setQuizStatsById(summary)
      const sortedRows = sortQuizzesByPriority(rows, new Date())
      if (sortedRows.length && !selectedQuizId) setSelectedQuizId(sortedRows[0].id)
      if (!rows.length) setSelectedQuizId('')
    })
  }

  useEffect(() => {
    if (!filteredQuizList.length) {
      if (selectedQuizId) setSelectedQuizId('')
      return
    }
    const hasSelected = filteredQuizList.some((q) => q.id === selectedQuizId)
    if (!selectedQuizId || !hasSelected) {
      setSelectedQuizId(filteredQuizList[0].id)
    }
  }, [filteredQuizList, selectedQuizId])

  useEffect(() => {
    loadQuizzes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKelas, selectedMapel, quizRealtimeTick, period.tahunAjaran, period.semester])

  const loadQuizDetails = async () => {
    if (!selectedQuizId) {
      setQuestions([])
      setOptionsByQuestion({})
      setParticipants([])
      setRetakeLogs([])
      setViolationLogs([])
      setPresenceByStudent({})
      setEssayProgressBySubmission({})
      return
    }

    try {
      const { data: detailData, error: detailError } = await supabase.quiz.detail(selectedQuizId, {
        tahun_ajaran: period.tahunAjaran,
        semester: period.semester
      })
      if (detailError?.code === 'REQUEST_ABORTED') return
      if (detailError) throw detailError

      const questionRows = normalizeQuestionNumbering(detailData?.questions || [])
      const byQuestion = detailData?.options_by_question || {}
      const submissionRows = detailData?.submissions || []
      const answersBySubmission = detailData?.answers_by_submission || {}

      let siswaRows = []
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, nama, nis, photo_path, photo_url')
          .eq('kelas', selectedKelas)
          .eq('role', 'siswa')
          .order('nama')
        if (error) throw error
        siswaRows = data || []
      } catch (err) {
        // Fallback untuk skema lama yang belum punya kolom photo_path.
        if (/photo_path/i.test(String(err?.message || ''))) {
          const { data } = await supabase
            .from('profiles')
            .select('id, nama, nis, photo_url')
            .eq('kelas', selectedKelas)
            .eq('role', 'siswa')
            .order('nama')
          siswaRows = data || []
        } else {
          throw err
        }
      }

      const submissionMap = new Map((submissionRows || []).map((s) => [s.siswa_id, s]))
      const peserta = (siswaRows || []).map((s) => ({
        ...s,
        submission: submissionMap.get(s.id) || null
      }))
      const siswaIds = (siswaRows || []).map((s) => s.id).filter(Boolean)
      const essayQuestionIds = (questionRows || [])
        .filter((q) => normalizeQuestionType(q?.question_type) === 'essay')
        .map((q) => q.id)
      const submissionIds = (submissionRows || []).map((s) => s.id).filter(Boolean)
      const essayProgressMap = {}
      submissionIds.forEach((submissionId) => {
        essayProgressMap[submissionId] = {
          answeredCount: 0,
          gradedCount: 0,
          pendingCount: 0
        }
      })

      if (essayQuestionIds.length && submissionIds.length) {
        Object.entries(answersBySubmission || {}).forEach(([submissionId, answerRows]) => {
          if (!essayProgressMap[submissionId]) return
          ;(answerRows || []).forEach((row) => {
            if (!essayQuestionIds.includes(row?.question_id)) return
            const answerText = String(row?.essay_answer || '').trim()
            if (!answerText) return
            essayProgressMap[submissionId].answeredCount += 1
            if (row?.essay_score == null) {
              essayProgressMap[submissionId].pendingCount += 1
            } else {
              essayProgressMap[submissionId].gradedCount += 1
            }
          })
        })
      }

      let historyRows = []
      try {
        const { data, error } = await supabase.quiz.retakeHistory(selectedQuizId)
        if (!error) {
          historyRows = data || []
        }
      } catch {
        historyRows = []
      }

      let warningRows = []
      try {
        const { data, error } = await supabase
          .from('quiz_violation_logs')
          .select('id, quiz_id, submission_id, siswa_id, event_type, event_message, event_meta, created_at')
          .eq('quiz_id', selectedQuizId)
          .order('created_at', { ascending: false })
          .limit(300)
        if (!error) {
          warningRows = data || []
        }
      } catch {
        warningRows = []
      }

      let presenceMap = {}
      try {
        if (siswaIds.length) {
          const { data: presenceRows, error: presenceError } = await supabase
            .from('user_presence')
            .select('user_id, last_seen_at, activity_count')
            .in('user_id', siswaIds)
            .order('last_seen_at', { ascending: false })
            .limit(2000)
          if (!presenceError) {
            const cutoffMs = Date.now() - ONLINE_ACTIVE_SECONDS * 1000
            ;(presenceRows || []).forEach((row) => {
              const userId = row?.user_id
              if (!userId) return
              if (!presenceMap[userId]) {
                presenceMap[userId] = {
                  online: false,
                  active_devices: 0,
                  activity_count: 0,
                  last_seen_at: null
                }
              }
              const current = presenceMap[userId]
              const seenAt = safeDate(row?.last_seen_at)
              if (seenAt) {
                const seenIso = seenAt.toISOString()
                if (!current.last_seen_at || seenIso > current.last_seen_at) {
                  current.last_seen_at = seenIso
                }
                if (seenAt.getTime() >= cutoffMs) {
                  current.online = true
                  current.active_devices += 1
                  current.activity_count += Number(row?.activity_count || 0)
                }
              }
            })
          }
        }
      } catch {
        presenceMap = {}
      }

      startTransition(() => {
        setQuestions(questionRows || [])
        setOptionsByQuestion(byQuestion)
        setParticipants(peserta)
        setRetakeLogs(historyRows)
        setViolationLogs(warningRows)
        setPresenceByStudent(presenceMap)
        setEssayProgressBySubmission(essayProgressMap)
      })
    } catch (err) {
      if (err?.code === 'REQUEST_ABORTED') return
      setViolationLogs([])
      setPresenceByStudent({})
      setEssayProgressBySubmission({})
      pushToast('error', err?.message || 'Gagal memuat detail quiz')
    }
  }

  useEffect(() => {
    loadQuizDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuizId, detailRealtimeTick, period.tahunAjaran, period.semester])

  useEffect(() => {
    setDetailStudent(null)
    setDetailSubmission(null)
    setDetailAnswers([])
    setDetailLoading(false)
    setDetailError('')
    setEssayScoreDraft({})
    setEssaySavingQuestionId('')
    setDetailFinishingReview(false)
  }, [selectedQuizId])

  useEffect(() => {
    if (!user?.id || !selectedKelas) return undefined

    const channel = supabase
      .channel(`guru-quiz-live-${user.id}-${selectedKelas}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quizzes',
          filter: `kelas_id=eq.${selectedKelas}`
        },
        (payload) => {
          const row = payload.new || payload.old
          if (!row) return
          queueQuizReload(80)
          if (row.id && row.id === selectedQuizIdRef.current) {
            queueDetailReload(80)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_submissions'
        },
        (payload) => {
          const row = payload.new || payload.old
          const quizId = row?.quiz_id
          if (!quizId) return
          if (!trackedQuizIdsRef.current.has(quizId)) return
          queueQuizReload(100)
          if (quizId === selectedQuizIdRef.current) {
            queueDetailReload(100)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_questions'
        },
        (payload) => {
          const row = payload.new || payload.old
          const quizId = row?.quiz_id
          if (!quizId) return
          if (!trackedQuizIdsRef.current.has(quizId)) return
          if (quizId === selectedQuizIdRef.current) {
            queueDetailReload(80)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_options'
        },
        (payload) => {
          const row = payload.new || payload.old
          const questionId = row?.question_id
          if (!questionId) return
          if (!trackedQuestionIdsRef.current.has(questionId)) return
          queueDetailReload(80)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_answers'
        },
        (payload) => {
          const row = payload.new || payload.old
          const submissionId = row?.submission_id
          const questionId = row?.question_id
          if (!submissionId) return
          if (!trackedSubmissionIdsRef.current.has(submissionId)) return
          if (questionId && !trackedQuestionIdsRef.current.has(questionId)) return
          queueDetailReload(80)
          queueQuizReload(120)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_violation_logs'
        },
        (payload) => {
          const row = payload.new || payload.old
          const quizId = row?.quiz_id
          if (!quizId || quizId !== selectedQuizIdRef.current) return
          queueDetailReload(60)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_presence'
        },
        (payload) => {
          const row = payload.new || payload.old
          const siswaId = row?.user_id
          if (!siswaId) return
          if (!trackedStudentIdsRef.current.has(siswaId)) return
          queueDetailReload(200)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, selectedKelas, queueQuizReload, queueDetailReload])

  useEffect(() => {
    if (!selectedQuiz) {
      setScheduleForm({
        starts_at: '',
        deadline_at: '',
        duration_minutes: 60
      })
      return
    }

    setScheduleForm({
      starts_at: toLocalInput(selectedQuiz.starts_at),
      deadline_at: toLocalInput(selectedQuiz.deadline_at),
      duration_minutes: Number(selectedQuiz.duration_minutes || 60)
    })
  }, [selectedQuiz?.id, selectedQuiz?.starts_at, selectedQuiz?.deadline_at, selectedQuiz?.duration_minutes])

  useEffect(() => {
    if (!selectedQuiz) {
      setSecurityForm({
        shuffle_questions: false,
        shuffle_options: false,
        max_attempts: '',
        access_code: '',
        security_mode: 'standard',
        access_device: 'both'
      })
      return
    }

    setSecurityForm({
      shuffle_questions: toBoolean(selectedQuiz.shuffle_questions),
      shuffle_options: toBoolean(selectedQuiz.shuffle_options),
      max_attempts: selectedQuiz.max_attempts ? String(selectedQuiz.max_attempts) : '',
      access_code: '',
      security_mode: selectedQuiz.security_mode || 'standard',
      access_device: normalizeAccessDevice(selectedQuiz.access_device)
    })
  }, [
    selectedQuiz?.id,
    selectedQuiz?.shuffle_questions,
    selectedQuiz?.shuffle_options,
    selectedQuiz?.max_attempts,
    selectedQuiz?.security_mode,
    selectedQuiz?.access_device
  ])

  const resetQuizForm = () => {
    setQuizForm({
      nama: '',
      mode: 'regular'
    })
    setEditingQuizId('')
  }

  const openCreateQuizForm = () => {
    resetQuizForm()
    setShowQuizForm(true)
  }

  const openEditQuizForm = () => {
    if (!selectedQuiz) return
    setEditingQuizId(selectedQuiz.id)
    setQuizForm({
      nama: selectedQuiz.nama || '',
      mode: normalizeMode(selectedQuiz)
    })
    setShowQuizForm(true)
  }

  const handleSaveQuizForm = async () => {
    if (!selectedKelas || !selectedMapel) {
      pushToast('error', 'Pilih kelas dan mapel terlebih dahulu')
      return
    }
    if (!quizForm.nama.trim()) {
      pushToast('error', 'Nama quiz wajib diisi')
      return
    }

    if (editingQuizId) {
      if (!selectedQuiz || selectedQuiz.id !== editingQuizId) {
        pushToast('error', 'Quiz yang diedit tidak ditemukan')
        return
      }

      const nextMode = normalizeMode({ mode: quizForm.mode })
      const currentMode = normalizeMode(selectedQuiz)
      if (nextMode !== currentMode && !canChangeSelectedQuizMode) {
        pushToast('error', 'Mode quiz tidak bisa diubah setelah quiz aktif atau sudah memiliki attempt siswa')
        return
      }

      const payload = {
        nama: quizForm.nama.trim(),
        updated_at: new Date().toISOString()
      }
      if (nextMode !== currentMode) {
        payload.mode = nextMode
        payload.is_live = nextMode !== 'regular'
        payload.duration_minutes = nextMode !== 'regular' ? Number(selectedQuiz.duration_minutes || 60) : null
        payload.deadline_at = null
        payload.starts_at = null
        payload.live_started_at = null
        payload.is_active = false
      }

      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('quizzes')
          .update(payload)
          .eq('id', editingQuizId)
          .select('id, nama, mode, is_live, is_active, starts_at, deadline_at, live_started_at, duration_minutes, access_device, updated_at')
          .maybeSingle()
        if (error) throw error
        const updatedQuiz = data || { ...selectedQuiz, ...payload }
        setQuizList((prev) => prev.map((row) => (row.id === editingQuizId ? { ...row, ...updatedQuiz } : row)))
        pushToast('success', 'Info quiz berhasil diperbarui')
        resetQuizForm()
        setShowQuizForm(false)
        await loadQuizzes()
      } catch (err) {
        pushToast('error', err?.message || 'Gagal memperbarui quiz')
      } finally {
        setLoading(false)
      }
      return
    }

    const payload = {
      id: makeId(),
      guru_id: user.id,
      kelas_id: selectedKelas,
      mapel: selectedMapel,
      nama: quizForm.nama.trim(),
      starts_at: null,
      deadline_at: null,
      penilaian: 'poin',
      mode: quizForm.mode,
      is_live: quizForm.mode !== 'regular',
      is_active: false,
      live_started_at: null,
      duration_minutes: quizForm.mode !== 'regular' ? 60 : null,
      result_visible_to_students: false,
      access_device: 'both',
      ...activeAcademicPeriodPayload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    try {
      setLoading(true)
      const { error } = await supabase.from('quizzes').insert(payload)
      if (error) throw error
      pushToast('success', 'Quiz berhasil dibuat')
      resetQuizForm()
      setShowQuizForm(false)
      await loadQuizzes()
      setSelectedQuizId(payload.id)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat quiz')
    } finally {
      setLoading(false)
    }
  }

  const isQuizDateInsidePeriod = (dateValue) => {
    const date = safeDate(dateValue)
    if (!date || !periodBounds.start || !periodBounds.end) return true
    return date >= periodBounds.start && date <= periodBounds.end
  }

  const validateQuizDateInsidePeriod = (dateValue, label) => {
    if (isQuizDateInsidePeriod(dateValue)) return true
    pushToast(
      'error',
      `${label} harus berada dalam tahun periode ${activeAcademicPeriod.tahunAjaran} (${periodRangeLabel}).`
    )
    return false
  }

  const securitySettingsDirty = useMemo(() => {
    if (!selectedQuiz) return false
    const savedMaxAttempts = selectedQuiz.max_attempts ? String(selectedQuiz.max_attempts) : ''
    return (
      toBoolean(selectedQuiz.shuffle_questions) !== Boolean(securityForm.shuffle_questions)
      || toBoolean(selectedQuiz.shuffle_options) !== Boolean(securityForm.shuffle_options)
      || savedMaxAttempts !== String(securityForm.max_attempts || '')
      || String(selectedQuiz.security_mode || 'standard') !== String(securityForm.security_mode || 'standard')
      || normalizeAccessDevice(selectedQuiz.access_device) !== normalizeAccessDevice(securityForm.access_device)
      || String(securityForm.access_code || '').trim() !== ''
    )
  }, [
    selectedQuiz,
    securityForm.shuffle_questions,
    securityForm.shuffle_options,
    securityForm.max_attempts,
    securityForm.security_mode,
    securityForm.access_device,
    securityForm.access_code
  ])

  const selectedQuizSettingsReady = useMemo(() => {
    if (!selectedQuiz) return { ok: false, message: 'Pilih quiz terlebih dahulu' }
    if (!['standard', 'strict'].includes(String(selectedQuiz.security_mode || '').toLowerCase())) {
      return { ok: false, message: 'Simpan mode keamanan quiz terlebih dahulu' }
    }
    if (!['web', 'mobile', 'both'].includes(normalizeAccessDevice(selectedQuiz.access_device))) {
      return { ok: false, message: 'Simpan akses perangkat quiz terlebih dahulu' }
    }
    if (securitySettingsDirty) {
      return { ok: false, message: 'Ada perubahan Keamanan & Akses yang belum disimpan' }
    }
    return { ok: true, message: 'Keamanan dan akses perangkat siap' }
  }, [selectedQuiz, securitySettingsDirty])

  const handleSaveSchedule = async () => {
    if (!selectedQuiz) return
    if (!questions.length) {
      pushToast('error', 'Tambahkan minimal 1 soal sebelum mengatur jadwal')
      return
    }
    if (!selectedQuizSettingsReady.ok) {
      pushToast('error', selectedQuizSettingsReady.message)
      return
    }
    if (!scheduleForm.starts_at) {
      pushToast('error', 'Tanggal mulai wajib diisi')
      return
    }
    if (!scheduleForm.deadline_at) {
      pushToast('error', 'Tanggal selesai wajib diisi')
      return
    }

    const startsAt = toMinuteDate(scheduleForm.starts_at)
    if (!startsAt) {
      pushToast('error', 'Tanggal mulai tidak valid')
      return
    }
    const deadlineAt = toMinuteDate(scheduleForm.deadline_at)
    if (!deadlineAt) {
      pushToast('error', 'Tanggal selesai tidak valid')
      return
    }
    if (deadlineAt <= startsAt) {
      pushToast('error', 'Tanggal selesai harus setelah tanggal mulai')
      return
    }

    const existingStart = toMinuteDate(selectedQuiz.starts_at)
    const hasStartChanged = !existingStart || existingStart.getTime() !== startsAt.getTime()
    const nowMinute = toMinuteDate(new Date())
    if (quizContentLocked && hasStartChanged) {
      pushToast('error', 'Saat ada siswa mengerjakan, tanggal mulai tidak boleh diubah. Ubah deadline atau durasi saja.')
      return
    }
    if (hasStartChanged && startsAt < nowMinute) {
      pushToast('error', 'Tanggal mulai tidak boleh di masa lalu. Pilih waktu setelah sekarang untuk menjadwalkan ulang quiz.')
      return
    }
    if (deadlineAt < nowMinute) {
      pushToast('error', 'Tanggal selesai tidak boleh di masa lalu')
      return
    }
    if (!validateQuizDateInsidePeriod(startsAt, 'Tanggal mulai')) return
    if (!validateQuizDateInsidePeriod(deadlineAt, 'Tanggal selesai')) return

    const duration = Math.ceil((deadlineAt.getTime() - startsAt.getTime()) / 60000)
    if (normalizeMode(selectedQuiz) !== 'regular' && duration < 10) {
      pushToast('error', 'Durasi ujian minimal 10 menit')
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase.quiz.schedule({
        quiz_id: selectedQuiz.id,
        starts_at: startsAt.toISOString(),
        deadline_at: deadlineAt.toISOString(),
        timezone: 'Asia/Jakarta'
      })
      if (error) throw error
      const freshQuiz = data?.quiz || null
      if (freshQuiz?.id) {
        setQuizList((prev) => prev.map((row) => (row.id === freshQuiz.id ? { ...row, ...freshQuiz } : row)))
      }
      await loadQuizzes()
      await loadQuizDetails()
      pushToast('success', `Jadwal quiz berhasil disimpan (${duration} menit)`)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan jadwal quiz')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSecuritySettings = async () => {
    if (!selectedQuiz) return
    if (quizContentLocked) {
      pushToast('error', 'Keamanan quiz dikunci selama masih ada siswa yang mengerjakan. Ubah waktu saja atau tunggu semua selesai.')
      return
    }
    const maxAttemptsRaw = String(securityForm.max_attempts || '').trim()
    const maxAttempts = maxAttemptsRaw === '' ? null : Number(maxAttemptsRaw)
    if (maxAttempts !== null && (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)) {
      pushToast('error', 'Batas percobaan harus 1 sampai 20')
      return
    }

    const payload = {
      quiz_id: selectedQuiz.id,
      activate: toBoolean(selectedQuiz.is_active),
      shuffle_questions: securityForm.shuffle_questions,
      shuffle_options: securityForm.shuffle_options,
      max_attempts: maxAttempts,
      security_mode: securityForm.security_mode || 'standard',
      access_device: normalizeAccessDevice(securityForm.access_device),
      timezone: 'Asia/Jakarta'
    }
    const accessCode = String(securityForm.access_code || '').trim()
    if (accessCode) {
      payload.access_code = accessCode
    }

    try {
      setSecuritySaving(true)
      const { data, error } = await supabase.quiz.publish(payload)
      if (error) throw error
      const freshQuiz = data?.quiz || null
      if (freshQuiz?.id) {
        setQuizList((prev) => prev.map((row) => (row.id === freshQuiz.id ? { ...row, ...freshQuiz } : row)))
      }
      setSecurityForm((prev) => ({ ...prev, access_code: '' }))
      pushToast('success', 'Pengaturan keamanan quiz disimpan')
      await loadQuizzes()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan keamanan quiz')
    } finally {
      setSecuritySaving(false)
    }
  }

  const handleCloseQuiz = async () => {
    if (!selectedQuiz) return
    const ok = window.confirm('Tutup quiz sekarang? Attempt yang sedang berlangsung akan difinalkan otomatis.')
    if (!ok) return

    try {
      setClosingQuiz(true)
      const { data, error } = await supabase.quiz.close({ quiz_id: selectedQuiz.id })
      if (error) throw error
      pushToast('success', `Quiz ditutup. ${data?.finalized_submissions ?? 0} attempt difinalkan.`)
      await loadQuizzes()
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menutup quiz')
    } finally {
      setClosingQuiz(false)
    }
  }

  const handleToggleResultVisibility = async () => {
    if (!selectedQuiz) return
    if (quizContentLocked) {
      pushToast('error', 'Visibilitas hasil dikunci selama masih ada siswa yang mengerjakan quiz.')
      return
    }
    const current = Boolean(selectedQuiz.result_visible_to_students)
    const next = !current
    try {
      setResultVisibilitySaving(true)
      const { error } = await supabase
        .from('quizzes')
        .update({
          result_visible_to_students: next,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedQuiz.id)
      if (error) throw error

      setQuizList((prev) => prev.map((row) => (
        row.id === selectedQuiz.id
          ? { ...row, result_visible_to_students: next, updated_at: new Date().toISOString() }
          : row
      )))
      pushToast('success', next ? 'Siswa sekarang bisa melihat hasil quiz.' : 'Hasil quiz disembunyikan dari siswa.')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal mengubah visibilitas hasil quiz')
    } finally {
      setResultVisibilitySaving(false)
    }
  }

  const openQuestionForm = (q = null) => {
    if (quizContentLocked) {
      pushToast('error', quizContentLockMessage || 'Soal dikunci selama masih ada siswa yang mengerjakan quiz.')
      return
    }
    if (!q) {
      setEditingQuestion(null)
      setQuestionForm({
        question_type: 'mcq',
        soal: '',
        image_path: '',
        poin: 10,
        options: { A: '', B: '', C: '', D: '' },
        option_images: { A: '', B: '', C: '', D: '' },
        correct: 'A'
      })
    } else {
      const opts = optionsByQuestion[q.id] || []
      const map = { A: '', B: '', C: '', D: '' }
      const optionImages = { A: '', B: '', C: '', D: '' }
      let correct = 'A'
      opts.forEach((o) => {
        map[o.label] = o.text
        optionImages[o.label] = o.image_path || ''
        if (o.is_correct) correct = o.label
      })
      setEditingQuestion(q)
      setQuestionForm({
        question_type: normalizeQuestionType(q.question_type),
        soal: q.soal || '',
        image_path: q.image_path || '',
        poin: q.poin || 10,
        options: map,
        option_images: optionImages,
        correct
      })
    }
    setQuestionImageUploading(false)
    setOptionImageUploading({})
    setShowQuestionForm(true)
  }

  const handleQuestionImageUpload = async (file) => {
    if (!file) return
    if (quizContentLocked) {
      pushToast('error', quizContentLockMessage || 'Soal dikunci selama masih ada siswa yang mengerjakan quiz.')
      return
    }
    if (!isSupportedQuizImage(file)) {
      pushToast('error', 'File gambar soal harus JPG/PNG')
      return
    }

    try {
      setQuestionImageUploading(true)
      const oldPath = questionForm.image_path || ''
      const uploaded = await uploadQuizImage(file, 'question')
      const uploadedPath = uploaded?.path || ''
      setQuestionForm((prev) => ({ ...prev, image_path: uploadedPath }))
      if (uploadedPath) {
        void ensureQuizImageSize(uploadedPath, uploaded?.uploadedSizeBytes || 0)
      }
      if (oldPath && oldPath !== uploadedPath) {
        await removeQuizImageIfExists(oldPath)
      }
      pushToast('success', `Gambar soal berhasil diunggah (${uploaded?.uploadedSizeLabel || '-'})`)
    } catch (err) {
      pushToast('error', err?.message || `Gagal upload gambar soal (maks ${Math.floor(QUIZ_IMAGE_MAX_BYTES / 1024)}KB)`)
    } finally {
      setQuestionImageUploading(false)
    }
  }

  const handleOptionImageUpload = async (label, file) => {
    if (!label || !file) return
    if (quizContentLocked) {
      pushToast('error', quizContentLockMessage || 'Soal dikunci selama masih ada siswa yang mengerjakan quiz.')
      return
    }
    if (!isSupportedQuizImage(file)) {
      pushToast('error', `File gambar opsi ${label} harus JPG/PNG`)
      return
    }

    try {
      setOptionImageUploading((prev) => ({ ...prev, [label]: true }))
      const oldPath = questionForm.option_images?.[label] || ''
      const uploaded = await uploadQuizImage(file, `option-${label.toLowerCase()}`)
      const uploadedPath = uploaded?.path || ''
      setQuestionForm((prev) => ({
        ...prev,
        option_images: {
          ...(prev.option_images || {}),
          [label]: uploadedPath
        }
      }))
      if (uploadedPath) {
        void ensureQuizImageSize(uploadedPath, uploaded?.uploadedSizeBytes || 0)
      }
      if (oldPath && oldPath !== uploadedPath) {
        await removeQuizImageIfExists(oldPath)
      }
      pushToast('success', `Gambar opsi ${label} berhasil diunggah (${uploaded?.uploadedSizeLabel || '-'})`)
    } catch (err) {
      pushToast('error', err?.message || `Gagal upload gambar opsi ${label}`)
    } finally {
      setOptionImageUploading((prev) => ({ ...prev, [label]: false }))
    }
  }

  const handleRemoveQuestionImage = async () => {
    const currentPath = questionForm.image_path || ''
    if (!currentPath) return
    setQuestionForm((prev) => ({ ...prev, image_path: '' }))
    await removeQuizImageIfExists(currentPath)
  }

  const handleRemoveOptionImage = async (label) => {
    const currentPath = questionForm.option_images?.[label] || ''
    setQuestionForm((prev) => ({
      ...prev,
      option_images: {
        ...(prev.option_images || {}),
        [label]: ''
      }
    }))
    if (currentPath) {
      await removeQuizImageIfExists(currentPath)
    }
  }

  const handleSaveQuestion = async () => {
    if (!selectedQuizId) return
    if (quizContentLocked) {
      pushToast('error', quizContentLockMessage || 'Soal dikunci selama masih ada siswa yang mengerjakan quiz.')
      return
    }
    if (!questionForm.soal.trim()) {
      pushToast('error', 'Isi soal wajib diisi')
      return
    }

    const questionType = normalizeQuestionType(questionForm.question_type)
    const questionPoint = Number(questionForm.poin || 0)
    if (!Number.isFinite(questionPoint) || questionPoint <= 0) {
      pushToast('error', 'Poin soal wajib lebih dari 0')
      return
    }
    const existingPoint = Number(editingQuestion?.poin || 0)
    const nextTotalPoints = editingQuestion?.id
      ? totalQuestionPoints - existingPoint + questionPoint
      : totalQuestionPoints + questionPoint

    if (nextTotalPoints > QUIZ_MAX_POINTS) {
      pushToast(
        'error',
        `Total poin melebihi ${QUIZ_MAX_POINTS}. Kurangi poin soal agar total tidak lebih dari ${QUIZ_MAX_POINTS}.`
      )
      return
    }

    const optionEntries = ['A', 'B', 'C', 'D'].map((label) => ({
      label,
      text: questionForm.options[label] || '',
      image_path: questionForm.option_images?.[label] || ''
    }))

    if (questionType === 'mcq' && optionEntries.some((o) => !o.text.trim())) {
      pushToast('error', 'Semua opsi jawaban wajib diisi')
      return
    }

    try {
      setLoading(true)
      let questionId = editingQuestion?.id
      const prevOptionImagePaths = questionId
        ? (optionsByQuestion[questionId] || []).map((opt) => opt.image_path).filter(Boolean)
        : []
      if (!questionId) {
        questionId = makeId()
        const nextNomor = questions.length + 1
        const { error } = await supabase.from('quiz_questions').insert({
          id: questionId,
          quiz_id: selectedQuizId,
          nomor: nextNomor,
          soal: questionForm.soal.trim(),
          image_path: questionForm.image_path || null,
          poin: questionPoint,
          question_type: questionType,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('quiz_questions')
          .update({
            soal: questionForm.soal.trim(),
            image_path: questionForm.image_path || null,
            poin: questionPoint,
            question_type: questionType,
            updated_at: new Date().toISOString()
          })
          .eq('id', questionId)
        if (error) throw error
        await supabase.from('quiz_options').delete().eq('question_id', questionId)
      }

      if (questionType === 'mcq') {
        const optionRows = optionEntries.map((o) => ({
          id: makeId(),
          question_id: questionId,
          label: o.label,
          text: o.text.trim(),
          image_path: o.image_path || null,
          is_correct: o.label === questionForm.correct,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }))
        const { error: optError } = await supabase.from('quiz_options').insert(optionRows)
        if (optError) throw optError
      } else if (prevOptionImagePaths.length) {
        await Promise.all(prevOptionImagePaths.map((path) => removeQuizImageIfExists(path)))
      }

      pushToast('success', 'Soal berhasil disimpan')
      setShowQuestionForm(false)
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan soal')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenStudentDetail = async (student) => {
    const sub = student?.submission
    if (!student?.id || !sub?.id) {
      pushToast('error', 'Siswa belum memiliki jawaban quiz')
      return
    }

    try {
      setDetailStudent(student)
      setDetailSubmission(sub)
      setDetailAnswers([])
      setDetailActiveQuestionIndex(0)
      setEssayScoreDraft({})
      setDetailError('')
      setDetailLoading(true)

      const { data, error } = await supabase
        .from('quiz_answers')
        .select('*')
        .eq('submission_id', sub.id)

      if (error) throw error

      const answerByQuestionId = new Map((data || []).map((row) => [row.question_id, row]))
      const rows = (questions || []).map((question, index) => {
        const answer = answerByQuestionId.get(question.id) || null
        const questionType = normalizeQuestionType(question?.question_type)
        const options = (optionsByQuestion[question.id] || [])
          .slice()
          .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
        const selectedOption = options.find((opt) => opt.id === answer?.option_id) || null
        const correctOption = options.find((opt) => Boolean(opt?.is_correct)) || null

        return {
          questionId: question.id,
          nomor: index + 1,
          soal: question.soal,
          questionImagePath: question.image_path || '',
          poin: Number(question.poin || 0),
          questionType,
          options,
          answerId: answer?.id || null,
          selectedOptionId: answer?.option_id || null,
          selectedOption,
          correctOption,
          essayAnswer: String(answer?.essay_answer || ''),
          essayScore: answer?.essay_score ?? null
        }
      })

      const drafts = {}
      rows.forEach((row) => {
        if (row.questionType === 'essay') {
          drafts[row.questionId] = row.essayScore == null ? '' : String(row.essayScore)
        }
      })

      setEssayScoreDraft(drafts)
      setDetailAnswers(rows)
      setDetailActiveQuestionIndex(0)
    } catch (err) {
      setDetailError(err?.message || 'Gagal memuat detail jawaban siswa')
      pushToast('error', err?.message || 'Gagal memuat detail jawaban siswa')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCloseStudentDetail = () => {
    setDetailStudent(null)
    setDetailSubmission(null)
    setDetailAnswers([])
    setDetailLoading(false)
    setDetailError('')
    setDetailActiveQuestionIndex(0)
    setEssayScoreDraft({})
    setEssaySavingQuestionId('')
    setDetailFinishingReview(false)
  }

  const handleFinishEssayCorrection = () => {
    if (!selectedQuiz?.id || !detailSubmission?.id || !detailStudent?.id) {
      return
    }
    if (detailSubmission?.essay_review_completed_at) {
      pushToast('success', 'Koreksi esai sudah ditandai selesai')
      handleCloseStudentDetail()
      return
    }
    if (detailEssayPendingCount > 0) {
      pushToast('error', `Masih ada ${detailEssayPendingCount} jawaban esai yang belum dinilai`)
      return
    }

    const run = async () => {
      try {
        setDetailFinishingReview(true)
        const { data, error } = await supabase.quiz.completeEssayReview({
          quiz_id: selectedQuiz.id,
          submission_id: detailSubmission.id,
          siswa_id: detailStudent.id
        })
        if (error) throw error

        const reviewedAt = data?.essay_review_completed_at || new Date().toISOString()
        const reviewedBy = data?.essay_review_completed_by || null

        setParticipants((prev) => prev.map((participant) => {
          if (participant.id !== detailStudent.id) return participant
          return {
            ...participant,
            submission: participant.submission
              ? {
                  ...participant.submission,
                  essay_review_completed_at: reviewedAt,
                  essay_review_completed_by: reviewedBy
                }
              : participant.submission
          }
        }))

        setDetailSubmission((prev) => (
          prev
            ? {
                ...prev,
                essay_review_completed_at: reviewedAt,
                essay_review_completed_by: reviewedBy
              }
            : prev
        ))

        queueDetailReload(30)
        queueQuizReload(50)
        pushToast('success', 'Koreksi esai ditandai selesai')
        handleCloseStudentDetail()
      } catch (err) {
        pushToast('error', err?.message || 'Gagal menandai koreksi selesai')
      } finally {
        setDetailFinishingReview(false)
      }
    }
    run()
  }

  const handleEssayScoreDraftChange = (questionId, value) => {
    setEssayScoreDraft((prev) => ({ ...prev, [questionId]: value }))
  }

  const handleSaveEssayScore = async (row) => {
    if (!selectedQuiz?.id || !detailSubmission?.id || !detailStudent?.id || !row?.questionId) {
      return
    }
    if (!row?.answerId) {
      pushToast('error', 'Jawaban esai siswa belum tersedia')
      return
    }

    const rawValue = String(essayScoreDraft[row.questionId] ?? '').trim()
    if (rawValue === '') {
      pushToast('error', 'Nilai esai wajib diisi')
      return
    }
    const score = Number(rawValue)
    if (!Number.isFinite(score) || !Number.isInteger(score)) {
      pushToast('error', 'Nilai esai harus bilangan bulat')
      return
    }
    const maxPoint = Number(row.poin || 0)
    const hasEssayAnswer = String(row.essayAnswer || '').trim() !== ''
    const minPoint = hasEssayAnswer && maxPoint > 0 ? 1 : 0
    if (score < minPoint || score > maxPoint) {
      pushToast('error', `Nilai esai harus ${minPoint} sampai ${maxPoint}`)
      return
    }

    try {
      setEssaySavingQuestionId(row.questionId)
      const { data, error } = await supabase.quiz.gradeEssay({
        quiz_id: selectedQuiz.id,
        submission_id: detailSubmission.id,
        siswa_id: detailStudent.id,
        question_id: row.questionId,
        essay_score: score
      })
      if (error) throw error

      setDetailAnswers((prev) => prev.map((item) => (
        item.questionId === row.questionId
          ? { ...item, essayScore: score }
          : item
      )))
      setEssayScoreDraft((prev) => ({ ...prev, [row.questionId]: String(score) }))
      setParticipants((prev) => prev.map((participant) => {
        if (participant.id !== detailStudent.id) return participant
        return {
          ...participant,
          submission: participant.submission
            ? {
                ...participant.submission,
                essay_review_completed_at: data?.essay_review_completed_at ?? null,
                essay_review_completed_by: data?.essay_review_completed_by ?? null,
                score: data?.score ?? participant.submission.score,
                total_points: data?.total_points ?? participant.submission.total_points
              }
            : participant.submission
        }
      }))
      setDetailSubmission((prev) => (
        prev
          ? {
              ...prev,
              essay_review_completed_at: data?.essay_review_completed_at ?? null,
              essay_review_completed_by: data?.essay_review_completed_by ?? null,
              score: data?.score ?? prev.score,
              total_points: data?.total_points ?? prev.total_points
            }
          : prev
      ))

      queueDetailReload(40)
      queueQuizReload(60)
      pushToast('success', 'Nilai esai berhasil disimpan')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan nilai esai')
    } finally {
      setEssaySavingQuestionId('')
    }
  }

  const handleDeleteQuestion = async (questionId) => {
    if (quizContentLocked) {
      pushToast('error', quizContentLockMessage || 'Soal dikunci selama masih ada siswa yang mengerjakan quiz.')
      return
    }
    if (!window.confirm('Hapus soal ini?')) return
    try {
      setLoading(true)
      await supabase.from('quiz_questions').delete().eq('id', questionId)
      const { data } = await supabase
        .from('quiz_questions')
        .select('id')
        .eq('quiz_id', selectedQuizId)
        .order('nomor', { ascending: true })
      const reorder = (data || []).map((q, idx) => ({
        id: q.id,
        nomor: idx + 1,
        updated_at: new Date().toISOString()
      }))
      for (const row of reorder) {
        await supabase.from('quiz_questions').update({ nomor: row.nomor, updated_at: row.updated_at }).eq('id', row.id)
      }
      await loadQuizDetails()
      pushToast('success', 'Soal dihapus')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menghapus soal')
    } finally {
      setLoading(false)
    }
  }

  const handleRetakeStudent = async (student) => {
    if (!selectedQuiz || !student?.id) return
    const submission = student.submission
    if (!submission?.id) {
      pushToast('error', 'Siswa belum punya attempt quiz')
      return
    }

    const scoreInfo = submission.score != null ? `${submission.score}` : '-'
    const ok = window.confirm(
      `Apakah siswa ${student.nama} ingin mengulang quiz?\nNilai sebelum ulang: ${scoreInfo}\nJawaban sebelumnya akan direset.`
    )
    if (!ok) return

    try {
      setLoading(true)
      const { data, error } = await supabase.quiz.retake({
        quiz_id: selectedQuiz.id,
        siswa_id: student.id,
        confirmed: true
      })
      if (error) throw error

      const prevScore = data?.previous_score
      const scoreLabel = prevScore != null ? prevScore : '-'
      pushToast('success', `Quiz ${student.nama} direset. Nilai sebelum ulang: ${scoreLabel}`)
      await loadQuizzes()
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal reset attempt siswa')
    } finally {
      setLoading(false)
    }
  }

  const handleRestorePreviousScore = async (student, latestRetake = null) => {
    if (!selectedQuiz || !student?.id) return

    const previousScore = latestRetake?.previous_score
    if (previousScore == null) {
      pushToast('error', 'Nilai sebelum ulang belum tersedia')
      return
    }

    const scoreLabel = `${previousScore}`
    const restoredAtLabel = latestRetake?.created_at ? formatDateTime(latestRetake.created_at) : '-'
    const ok = window.confirm(
      `Pulihkan nilai sebelum ulang untuk ${student.nama}?\nNilai sebelum ulang: ${scoreLabel}\nWaktu retake: ${restoredAtLabel}\nNilai attempt saat ini akan diganti.`
    )
    if (!ok) return

    try {
      setRetakeRestoreStudentId(student.id)
      const { data, error } = await supabase.quiz.restoreRetakeScore({
        quiz_id: selectedQuiz.id,
        siswa_id: student.id
      })
      if (error) throw error

      const restoredScore = data?.score ?? previousScore
      pushToast('success', `Nilai ${student.nama} dipulihkan ke ${restoredScore}`)
      await loadQuizzes()
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memulihkan nilai sebelum ulang')
    } finally {
      setRetakeRestoreStudentId('')
    }
  }

  const selectedStatus = useMemo(() => {
    if (!selectedQuiz) return null
    return getQuizStatus(selectedQuiz, nowTick)
  }, [selectedQuiz, nowTick])

  const selectedRemainingSeconds = useMemo(() => {
    if (!selectedQuiz || !selectedStatus || selectedStatus.kind !== 'active') return null
    return getRemainingSeconds(selectedQuiz, nowTick)
  }, [selectedQuiz, selectedStatus, nowTick])

  const selectedStartCountdownSeconds = useMemo(() => {
    if (!selectedQuiz || !selectedStatus || selectedStatus.kind !== 'scheduled') return null
    const startsAt = safeDate(selectedQuiz?.starts_at)
    if (!startsAt) return null
    return Math.floor((startsAt.getTime() - nowTick.getTime()) / 1000)
  }, [selectedQuiz, selectedStatus, nowTick])

  const selectedCountdownMeta = useMemo(() => {
    if (selectedStatus?.kind === 'active' && selectedRemainingSeconds != null) {
      return {
        label: 'Timer Quiz',
        seconds: selectedRemainingSeconds,
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }
    }
    if (selectedStatus?.kind === 'scheduled' && selectedStartCountdownSeconds != null) {
      return {
        label: 'Mulai dalam',
        seconds: selectedStartCountdownSeconds,
        tone: 'border-amber-200 bg-amber-50 text-amber-800'
      }
    }
    return null
  }, [selectedStatus?.kind, selectedRemainingSeconds, selectedStartCountdownSeconds])

  const schedulePreviewEndAt = useMemo(() => {
    if (!selectedQuiz || !scheduleForm.starts_at) return null
    return toMinuteDate(scheduleForm.deadline_at)
  }, [
    selectedQuiz,
    scheduleForm.starts_at,
    scheduleForm.deadline_at
  ])

  const scheduleDurationMinutes = useMemo(() => {
    const startsAt = toMinuteDate(scheduleForm.starts_at)
    const deadlineAt = toMinuteDate(scheduleForm.deadline_at)
    if (!startsAt || !deadlineAt || deadlineAt <= startsAt) return null
    return Math.ceil((deadlineAt.getTime() - startsAt.getTime()) / 60000)
  }, [scheduleForm.starts_at, scheduleForm.deadline_at])

  const periodStartInput = useMemo(() => (
    period.startsAt ? `${period.startsAt}T00:00` : ''
  ), [period.startsAt])

  const periodEndInput = useMemo(() => (
    period.endsAt ? `${period.endsAt}T23:59` : ''
  ), [period.endsAt])

  const startInputMin = useMemo(() => {
    const nowInput = getNowLocalInput()
    if (periodStartInput && periodStartInput > nowInput) return periodStartInput
    return nowInput
  }, [nowTick, periodStartInput])

  const deadlineInputMin = scheduleForm.starts_at || startInputMin

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="page-title-card">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-indigo-500 to-blue-600 rounded-full"></div>
              <div>
                <h1 className="page-title-heading">Kelola Quiz</h1>
                <p className="page-title-description">Atur quiz untuk kelas yang Anda ampu dengan jadwal terstruktur.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="bg-gradient-to-r from-gray-50 to-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Guru Aktif</div>
                <div className="font-semibold text-slate-800">{user?.email || '-'}</div>
              </div>
              <button
                type="button"
                onClick={openCreateQuizForm}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold hover:from-indigo-700 hover:to-blue-700 transition-all shadow-sm hover:shadow-md"
              >
                + Buat Quiz
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mt-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Kelas</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm shadow-sm"
                value={selectedKelas}
                onChange={(e) => setSelectedKelas(e.target.value)}
              >
                {kelasList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama || k.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Mata Pelajaran</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm shadow-sm"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
              >
                {mapelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Bulan</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm shadow-sm"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                <option value={MONTH_FILTER_ALL}>Semua bulan periode</option>
                {monthOptions.map((monthKey) => (
                  <option key={monthKey} value={monthKey}>
                    {formatQuizMonthLabel(monthKey)}
                  </option>
                ))}
              </select>
            </div>
            <AcademicPeriodArchiveFilter
              activeAcademicPeriod={activeAcademicPeriod}
              periodFilter={periodFilter}
              academicYearOptions={academicYearOptions}
              semesterOptions={semesterOptions}
              setAcademicYear={setAcademicYear}
              setSemester={setSemester}
              resetToActivePeriod={resetToActivePeriod}
              title="Periode Quiz"
              compact
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1.5 rounded-full bg-indigo-600"></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Daftar Quiz</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{filteredQuizList.length} quiz tersedia</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <span className="rounded-md bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {selectedMapel || 'Semua mapel'}
                </span>
                <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {selectedMonthLabel}
                </span>
              </div>
            </div>
            <div className="p-4 space-y-3 min-h-[30rem] max-h-[calc(100vh-130px)] overflow-y-auto">
              {filteredQuizList.length === 0 && (
                <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                  Belum ada quiz.
                </div>
              )}
              {filteredQuizList.map((q) => {
                const status = getQuizStatus(q, nowTick)
                const mutationMeta = getQuizMutationMeta(q)
                const resultVisible = Boolean(q.result_visible_to_students)
                const stats = quizStatsById[q.id] || {}
                const countdownMeta = getQuizCountdownMeta(q, status, nowTick)
                const quizEndAt = getQuizEndAt(q)
                const essayQuestionCount = Number(stats.essay_question_count || 0)
                const essayAnsweredCount = Number(stats.essay_answered_count || 0)
                const essayGradedCount = Number(stats.essay_graded_count || 0)
                const essayStudentPendingCount = Number(stats.essay_student_pending_count || 0)
                const essayStudentGradedCount = Number(stats.essay_student_graded_count || 0)
                const correctionTone = essayQuestionCount === 0
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : essayStudentPendingCount > 0
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : essayStudentGradedCount > 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                const correctionLabel = essayQuestionCount === 0
                  ? 'Tanpa esai'
                  : (essayStudentPendingCount > 0 || essayStudentGradedCount > 0)
                    ? `Siswa dikoreksi ${essayStudentGradedCount} • Belum ${essayStudentPendingCount}`
                    : essayAnsweredCount > 0
                      ? `Esai terkoreksi (${essayGradedCount})`
                      : 'Belum ada jawaban esai'
                const correctionBorder = essayStudentPendingCount > 0 ? 'ring-1 ring-red-200/70' : ''
                const isSelected = selectedQuizId === q.id
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuizId(q.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
                    } ${correctionBorder}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-slate-900">{q.nama}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {getModeLabel(q)} • Akses {getAccessDeviceLabel(q.access_device)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] ${status.tone}`}>
                          {status.label}
                        </span>
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] ${mutationMeta.tone}`}>
                          {mutationMeta.label}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-slate-500">
                      <div>
                        <span className="block font-medium text-slate-700">Mulai</span>
                        <span>{q.starts_at ? formatDateTime(q.starts_at) : '-'}</span>
                      </div>
                      <div>
                        <span className="block font-medium text-slate-700">Selesai</span>
                        <span>{quizEndAt ? formatDateTime(quizEndAt) : '-'}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span>Total siswa: {stats.total_students ?? 0}</span>
                      <span>Belum: {stats.not_started_count ?? 0}</span>
                      {essayQuestionCount > 0 && (
                        <span>Koreksi: {essayStudentGradedCount}/{essayStudentGradedCount + essayStudentPendingCount}</span>
                      )}
                      <span>Hasil: {resultVisible ? 'Aktif' : 'Nonaktif'}</span>
                    </div>
                    <div className={`mt-3 inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold ${correctionTone}`}>
                      {correctionLabel}
                    </div>
                    {countdownMeta && (
                      <div className={`mt-3 rounded-lg border px-3 py-2 ${countdownMeta.tone}`}>
                        <div className="text-[11px] font-semibold">{countdownMeta.label}</div>
                        <div className="mt-1 text-sm font-bold leading-none">
                          {formatRemaining(countdownMeta.seconds)}
                        </div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

        <div className="lg:col-span-2 space-y-6">
          {!selectedQuiz && (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 shadow-sm">
              Pilih quiz untuk melihat detail.
            </div>
          )}

          {selectedQuiz && (
            <>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-1.5 rounded-full bg-blue-600"></div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{selectedQuiz.nama}</h3>
                      <p className="text-sm text-slate-500">
                        {getModeLabel(selectedQuiz)} • Akses {getAccessDeviceLabel(selectedQuiz.access_device)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={openEditQuizForm}
                      className="inline-flex w-fit rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
                    >
                      Edit Info Quiz
                    </button>
                    {selectedStatus && (
                      <span className={`inline-flex w-fit rounded-md border px-2.5 py-1 text-xs ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    )}
                    <span className={`inline-flex w-fit rounded-md border px-2.5 py-1 text-[11px] ${getQuizMutationMeta(selectedQuiz).tone}`}>
                      {getQuizMutationMeta(selectedQuiz).label}
                    </span>
                    <span className={`inline-flex w-fit rounded-md border px-2.5 py-1 text-[11px] ${
                      selectedQuiz?.result_visible_to_students
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}>
                      Hasil ke siswa: {selectedQuiz?.result_visible_to_students ? 'Aktif' : 'Nonaktif'}
                    </span>
                    {selectedCountdownMeta && (
                      <div className={`rounded-lg border px-3 py-2 text-right ${selectedCountdownMeta.tone}`}>
                        <div className="text-[11px] font-semibold">{selectedCountdownMeta.label}</div>
                        <div className="mt-0.5 text-base font-bold leading-none">
                          {formatRemaining(selectedCountdownMeta.seconds)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700">
                    Total siswa mapel: <span className="font-semibold text-slate-900">{totalStudents}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700">
                    Sudah mengerjakan: <span className="font-semibold text-slate-900">{joinedCount}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700">
                    Belum mengerjakan: <span className="font-semibold text-slate-900">{notStartedCount}</span>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${
                    quizContentLocked
                      ? 'border-orange-200 bg-orange-50 text-orange-700'
                      : 'border-slate-200 text-slate-700'
                  }`}>
                    Sedang mengerjakan: <span className="font-semibold">
                      {activeWorkingStudents.length} siswa
                      {ongoingOnlineCount > 0 ? ` • ${ongoingOnlineCount} online` : ''}
                    </span>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${
                    selectedEssayStudentPendingCount > 0
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : selectedEssayQuestionCount > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600'
                  }`}>
                    Status koreksi: <span className="font-semibold">
                      {selectedEssayQuestionCount === 0
                        ? 'Tanpa esai'
                        : `Belum ${selectedEssayStudentPendingCount} • Sudah ${selectedEssayStudentGradedCount}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-1.5 rounded-full bg-emerald-600"></div>
                    <h3 className="text-lg font-bold text-slate-900">Jadwal Quiz</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                  >
                    Simpan Jadwal
                  </button>
                </div>
                <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-semibold text-slate-600">Tanggal Mulai</label>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      min={startInputMin}
                      max={periodEndInput || undefined}
                      value={scheduleForm.starts_at}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, starts_at: e.target.value }))}
                      disabled={quizContentLocked}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-600">Tanggal Selesai</label>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      min={deadlineInputMin}
                      max={periodEndInput || undefined}
                      value={scheduleForm.deadline_at}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, deadline_at: e.target.value }))}
                    />
                  </div>
                </div>
                {scheduleDurationMinutes != null && (
                  <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700">
                    Total durasi otomatis: <span className="font-semibold">{scheduleDurationMinutes} menit</span>
                    {normalizeMode(selectedQuiz) !== 'regular' && ' (dipakai sebagai timer UTS/UAS siswa)'}
                  </div>
                )}
                {schedulePreviewEndAt && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                    Perkiraan selesai: <span className="font-semibold">{formatDateTime(schedulePreviewEndAt)}</span>
                  </div>
                )}
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  Batas tahun periode: {periodRangeLabel}. Saat ada siswa mengerjakan, hanya deadline/durasi yang boleh diubah.
                </div>
                <div className={`mt-3 rounded-lg border p-3 text-xs ${
                  selectedQuizSettingsReady.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  Status sebelum jadwal: <span className="font-semibold">{selectedQuizSettingsReady.message}</span>
                </div>
                {selectedStatus?.kind === 'expired' && !quizContentLocked && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    Quiz ini sudah berakhir. Untuk menjadwalkan ulang, ubah Tanggal Mulai ke waktu setelah sekarang dan sesuaikan durasi/deadline.
                  </div>
                )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-1.5 rounded-full bg-slate-700"></div>
                    <h3 className="text-lg font-bold text-slate-900">Keamanan Quiz</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveSecuritySettings}
                      disabled={securitySaving || quizContentLocked}
                      className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-900 disabled:opacity-60"
                    >
                      {securitySaving ? 'Menyimpan...' : quizContentLocked ? 'Keamanan Dikunci' : 'Simpan Keamanan'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCloseQuiz}
                      disabled={closingQuiz}
                      className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
                    >
                      {closingQuiz ? 'Menutup...' : 'Tutup Quiz'}
                    </button>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-700">Acak urutan soal</span>
                    <input
                      type="checkbox"
                      className="h-5 w-5 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
                      checked={securityForm.shuffle_questions}
                      onChange={(e) => setSecurityForm((prev) => ({ ...prev, shuffle_questions: e.target.checked }))}
                      disabled={quizContentLocked}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-700">Acak opsi jawaban</span>
                    <input
                      type="checkbox"
                      className="h-5 w-5 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
                      checked={securityForm.shuffle_options}
                      onChange={(e) => setSecurityForm((prev) => ({ ...prev, shuffle_options: e.target.checked }))}
                      disabled={quizContentLocked}
                    />
                  </label>
                  <div>
                    <label className="text-sm font-semibold text-slate-600">Batas Percobaan</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      value={securityForm.max_attempts}
                      onChange={(e) => setSecurityForm((prev) => ({ ...prev, max_attempts: e.target.value }))}
                      disabled={quizContentLocked}
                    >
                      {ATTEMPT_LIMIT_OPTIONS.map((option) => (
                        <option key={option.value || 'none'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[11px] text-slate-500">Kosong berarti guru bebas memberi retake.</div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-600">Mode Keamanan</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      value={securityForm.security_mode}
                      onChange={(e) => setSecurityForm((prev) => ({ ...prev, security_mode: e.target.value }))}
                      disabled={quizContentLocked}
                    >
                      <option value="standard">Standard</option>
                      <option value="strict">Strict</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-semibold text-slate-600">Akses Perangkat Quiz</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      value={securityForm.access_device}
                      onChange={(e) => setSecurityForm((prev) => ({ ...prev, access_device: e.target.value }))}
                      disabled={quizContentLocked}
                    >
                      {ACCESS_DEVICE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {ACCESS_DEVICE_OPTIONS.find((option) => option.value === normalizeAccessDevice(securityForm.access_device))?.help}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-semibold text-slate-600">
                      Kode Akses Baru
                      <span className={`ml-2 rounded-md border px-2 py-0.5 text-[11px] ${
                        selectedQuiz?.has_access_code
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500'
                      }`}>
                        {selectedQuiz?.has_access_code ? 'Kode aktif' : 'Belum memakai kode'}
                      </span>
                    </label>
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      value={securityForm.access_code}
                      onChange={(e) => setSecurityForm((prev) => ({ ...prev, access_code: e.target.value }))}
                      placeholder="Kosongkan jika tidak diubah"
                      disabled={quizContentLocked}
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-1.5 rounded-full bg-indigo-600"></div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Soal Quiz</h3>
                      <div className={`text-xs font-semibold mt-0.5 ${
                        totalQuestionPoints > QUIZ_MAX_POINTS ? 'text-red-600' : 'text-slate-500'
                      }`}>
                        Total poin: {totalQuestionPoints}/{QUIZ_MAX_POINTS}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleResultVisibility}
                      disabled={!selectedQuiz || resultVisibilitySaving || quizContentLocked}
	                      className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                        selectedQuiz?.result_visible_to_students
                          ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {resultVisibilitySaving
                        ? 'Menyimpan...'
                        : quizContentLocked
                          ? 'Hasil Dikunci'
                        : selectedQuiz?.result_visible_to_students
                          ? 'Hasil ke Siswa: Aktif'
                          : 'Hasil ke Siswa: Nonaktif'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewQuestionIndex(0)
                        setShowStudentPreview(true)
                      }}
                      disabled={!questions.length}
	                      className="rounded-lg border border-indigo-200 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                    >
                      Preview Siswa
                    </button>
                    <button
                      type="button"
                      onClick={() => openQuestionForm()}
                      disabled={quizContentLocked}
	                      className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {quizContentLocked ? 'Soal Dikunci' : '+ Tambah Soal'}
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {questions.length === 0 && (
                    <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                      Belum ada soal.
                    </div>
                  )}
                  {questions.length > 0 && (
                    <div className="sticky top-3 z-10 rounded-2xl border border-indigo-100 bg-white/95 p-3 shadow-sm backdrop-blur">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Navigasi Soal
                        </span>
                        <span className="text-xs font-semibold text-slate-600">
                          {questions.length} soal
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {questions.map((question, idx) => (
                          <button
                            key={`nav-${question.id}`}
                            type="button"
                            onClick={() => setTeacherQuestionIndex(idx)}
                            className={`h-9 min-w-9 rounded-xl border px-3 text-sm font-bold transition-colors ${
                              idx === teacherQuestionIndex
                                ? 'border-indigo-600 bg-indigo-600 text-white'
                                : normalizeQuestionType(question.question_type) === 'essay'
                                ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                            }`}
                            title={`Soal ${idx + 1} - ${getQuestionTypeLabel(question.question_type)}`}
                          >
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {quizContentLocked && (
                    <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                      <div className="font-semibold">Edit soal dikunci saat quiz sedang dikerjakan.</div>
                      <div className="mt-1 text-xs">
                        Aktif: {activeWorkingStudents.slice(0, 6).map((s) => s.nama).join(', ')}
                        {activeWorkingStudents.length > 6 ? `, +${activeWorkingStudents.length - 6} siswa lain` : ''}
                      </div>
                    </div>
                  )}
                  {teacherQuestion && (
                    <div
                      key={teacherQuestion.id}
                      id={`quiz-question-${teacherQuestion.id}`}
                      className="scroll-mt-28 border border-slate-200 rounded-2xl p-4 bg-white transition-all duration-300 hover:shadow-sm hover:border-indigo-200"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900">
                          Soal {teacherQuestionIndex + 1} • {teacherQuestion.poin} poin
                        </div>
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => openQuestionForm(teacherQuestion)}
                            disabled={quizContentLocked}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(teacherQuestion.id)}
                            disabled={quizContentLocked}
                            className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                      <div className="mt-1">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          normalizeQuestionType(teacherQuestion.question_type) === 'essay'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {getQuestionTypeLabel(teacherQuestion.question_type)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 mt-2">{teacherQuestion.soal}</p>
                      {teacherQuestion.image_path && (
                        <div className="mt-3">
                          <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <img
                              src={getQuizImageUrl(teacherQuestion.image_path)}
                              alt={`Gambar soal ${teacherQuestionIndex + 1}`}
                              className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                              onClick={() => setPreviewMediaUrl(getQuizImageUrl(teacherQuestion.image_path))}
                            />
                            <div className="mt-1 text-[11px] text-slate-500">
                              Ukuran: {getQuizImageSizeLabel(teacherQuestion.image_path)}
                            </div>
                          </div>
                        </div>
                      )}
                      {normalizeQuestionType(teacherQuestion.question_type) === 'essay' ? (
                        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          Soal esai dinilai manual oleh guru setelah siswa submit.
                        </div>
                      ) : (
                        (() => {
                          const optionRows = (optionsByQuestion[teacherQuestion.id] || [])
                            .slice()
                            .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
                          return (
                            <div className="mt-3 space-y-2">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
                                {optionRows.map((opt) => (
                                  <div key={opt.id} className="space-y-2">
                                    <div
                                      className={`text-sm px-3 py-2 rounded-xl border min-h-[46px] ${
                                        opt.is_correct ? 'border-green-400 bg-green-50 text-green-700 shadow-sm' : 'border-slate-200 bg-slate-50/40'
                                      }`}
                                    >
                                      <span className="font-semibold mr-2">{opt.label}.</span>
                                      {opt.text}
                                    </div>
                                    {!!opt.image_path && (
                                      <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                                        <img
                                          src={getQuizImageUrl(opt.image_path)}
                                          alt={`Gambar opsi ${opt.label}`}
                                          className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                          onClick={() => setPreviewMediaUrl(getQuizImageUrl(opt.image_path))}
                                        />
                                        <div className="mt-1 text-[11px] text-slate-500">
                                          Ukuran: {getQuizImageSizeLabel(opt.image_path)}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })()
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-purple-600 rounded-full"></div>
                    <h3 className="text-lg font-bold text-slate-900">Status Siswa</h3>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {!participants.length && (
                    <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                      Belum ada siswa di kelas ini.
                    </div>
                  )}
                  {!!participants.length && (
                    <>
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 mb-2">
                          <span>Siswa sudah mengerjakan ({attemptedStudents.length})</span>
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            Sedang mengerjakan: {ongoingStudents.length}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                            Online: {ongoingOnlineCount}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {!attemptedStudents.length && (
                            <div className="text-xs text-slate-500 p-3 border border-dashed border-slate-200 rounded-xl">
                              Belum ada siswa yang mulai mengerjakan.
                            </div>
                          )}
                          {attemptedStudents.map((p) => {
                            const sub = p.submission
                            const warningSummary = sub?.id ? violationSummaryBySubmission[sub.id] : null
                            const warningCount = Number(warningSummary?.count || 0)
                            const essayProgress = sub?.id ? essayProgressBySubmission[sub.id] : null
                            const essayPendingCount = Number(essayProgress?.pendingCount || 0)
                            const showCorrectionStatus = hasEssayQuestions && sub?.status === 'finished'
                            const isEssayCorrected = Boolean(sub?.essay_review_completed_at)
                            const presence = presenceByStudent[p.id] || null
                            const isOnline = Boolean(presence?.online)
                            const status = sub?.status === 'finished' ? 'Selesai' : 'Mengerjakan'
                            const durationText = formatDurationText(sub?.started_at, sub?.finished_at || nowTick)
                            const latestRetake = latestRetakeByStudent[p.id] || null
                            const prevScoreText = latestRetake?.previous_score != null ? latestRetake.previous_score : '-'
                            const canRestorePrevScore = latestRetake?.previous_score != null
                            const isRestoringPrevScore = retakeRestoreStudentId === p.id
                            return (
                              <div
                                key={p.id}
                                className={`flex items-center justify-between p-3 border rounded-xl bg-white transition-all duration-300 ${
                                  isOnline
                                    ? 'border-orange-300 bg-orange-50/40 hover:border-orange-400'
                                    : 'border-slate-200 hover:border-emerald-200'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <ProfileAvatar
                                    src={p.photo_path || p.photo_url || ''}
                                    name={p.nama || 'Siswa'}
                                    size={38}
                                    className="shrink-0"
                                  />
                                  <div>
                                  <div className="font-semibold text-slate-900">{p.nama}</div>
                                  <div className="text-xs text-slate-500">NIS: {p.nis || '-'}</div>
                                  <div className="text-xs text-slate-500">Durasi: {durationText}</div>
                                  {sub?.last_saved_at && (
                                    <div className="text-xs text-slate-500">
                                      Simpan terakhir: {formatDateTime(sub.last_saved_at)}
                                    </div>
                                  )}
                                  <div className={`text-[11px] font-semibold ${isOnline ? 'text-orange-700' : 'text-slate-500'}`}>
                                    {isOnline
                                      ? 'Online sekarang'
                                      : `Offline${presence?.last_seen_at ? ` • Terakhir online: ${formatDateTime(presence.last_seen_at)}` : ''}`}
                                  </div>
                                  <div className={`text-[11px] font-semibold mt-1 ${warningCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                                    Peringatan attempt ini: {warningCount}
                                    {warningSummary?.lastAt ? ` • ${formatDateTime(warningSummary.lastAt)}` : ''}
                                  </div>
                                  {!!warningSummary?.lastMessage && (
                                    <div className="text-[11px] text-red-600">
                                      {warningSummary.lastMessage}
                                    </div>
                                  )}
                                  {latestRetake && (
                                    <div className="text-[11px] text-indigo-600 mt-1">
                                      Nilai sebelum ulang: {prevScoreText} • {formatDateTime(latestRetake.created_at)}
                                    </div>
                                  )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`text-xs px-2 py-1 rounded-full ${
                                      sub?.status === 'finished'
                                        ? 'bg-green-100 text-green-700'
                                        : isOnline
                                          ? 'bg-orange-100 text-orange-700 border border-orange-200'
                                          : 'bg-yellow-100 text-yellow-700'
                                    }`}
                                  >
                                    {status}
                                  </span>
                                  {showCorrectionStatus && (
                                    <span
                                      className={`text-xs px-2 py-1 rounded-full border ${
                                        isEssayCorrected
                                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                          : 'bg-amber-100 text-amber-700 border-amber-200'
                                      }`}
                                    >
                                      {isEssayCorrected ? '✓ Dikoreksi' : 'Belum dikoreksi'}
                                    </span>
                                  )}
                                  {showCorrectionStatus && !isEssayCorrected && essayPendingCount > 0 && (
                                    <span className="text-xs px-2 py-1 rounded-full border bg-red-100 text-red-700 border-red-200">
                                      Pending nilai esai: {essayPendingCount}
                                    </span>
                                  )}
                                  <div className="text-sm font-semibold text-slate-700 min-w-16 text-right">
                                    {sub?.score != null ? `${sub.score}` : '-'}
                                  </div>
                                  <span
                                    className={`text-xs px-2 py-1 rounded-full border ${
                                      warningCount > 0
                                        ? 'bg-red-100 text-red-700 border-red-200'
                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                    }`}
                                  >
                                    Peringatan {warningCount}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStudentDetail(p)}
                                    className="text-xs px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                  >
                                    Detail
                                  </button>
                                  {canRestorePrevScore && (
                                    <button
                                      type="button"
                                      onClick={() => handleRestorePreviousScore(p, latestRetake)}
                                      disabled={isRestoringPrevScore}
                                      className="text-xs px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                                    >
                                      {isRestoringPrevScore ? 'Memulihkan...' : 'Pulihkan Nilai'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleRetakeStudent(p)}
                                    className="text-xs px-3 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                                  >
                                    Ulang Quiz
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100">
                        <div className="text-xs font-semibold text-slate-600 mb-2">
                          Siswa belum mengerjakan ({notStartedStudents.length})
                        </div>
                        <div className="space-y-2">
                          {!notStartedStudents.length && (
                            <div className="text-xs text-emerald-600 p-3 border border-emerald-200 bg-emerald-50 rounded-xl">
                              Semua siswa sudah mengerjakan quiz.
                            </div>
                          )}
                          {notStartedStudents.map((s) => {
                            const latestRetake = latestRetakeByStudent[s.id] || null
                            const prevScoreText = latestRetake?.previous_score != null ? latestRetake.previous_score : '-'
                            const canRestorePrevScore = latestRetake?.previous_score != null
                            const isRestoringPrevScore = retakeRestoreStudentId === s.id
                            const presence = presenceByStudent[s.id] || null
                            const isOnline = Boolean(presence?.online)
                            return (
                              <div
                                key={s.id}
                                className={`flex items-center justify-between p-3 border rounded-xl ${
                                  isOnline
                                    ? 'border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50'
                                    : 'border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <ProfileAvatar
                                    src={s.photo_path || s.photo_url || ''}
                                    name={s.nama || 'Siswa'}
                                    size={38}
                                    className="shrink-0"
                                  />
                                  <div>
                                  <div className="font-semibold text-slate-900">{s.nama}</div>
                                  <div className="text-xs text-slate-500">NIS: {s.nis || '-'}</div>
                                  <div className={`text-[11px] font-semibold ${isOnline ? 'text-orange-700' : 'text-slate-500'}`}>
                                    {isOnline
                                      ? 'Online sekarang'
                                      : `Offline${presence?.last_seen_at ? ` • Terakhir online: ${formatDateTime(presence.last_seen_at)}` : ''}`}
                                  </div>
                                  {latestRetake && (
                                    <div className="text-[11px] text-indigo-600 mt-1">
                                      Nilai sebelum ulang: {prevScoreText} • {formatDateTime(latestRetake.created_at)}
                                    </div>
                                  )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {canRestorePrevScore && (
                                    <button
                                      type="button"
                                      onClick={() => handleRestorePreviousScore(s, latestRetake)}
                                      disabled={isRestoringPrevScore}
                                      className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                                    >
                                      {isRestoringPrevScore ? 'Memulihkan...' : 'Pulihkan Nilai'}
                                    </button>
                                  )}
                                  <span className={`text-[11px] px-2 py-1 rounded-full border ${
                                    isOnline
                                      ? 'bg-orange-100 text-orange-700 border-orange-200'
                                      : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                                  }`}>
                                    Belum mulai
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100">
                        <div className="text-xs font-semibold text-red-600 mb-2">
                          Riwayat Peringatan Quiz ({violationLogs.length})
                        </div>
                        {!violationLogs.length && (
                          <div className="text-xs text-slate-500 p-3 border border-dashed border-slate-200 rounded-xl">
                            Belum ada peringatan untuk quiz ini.
                          </div>
                        )}
                        {!!violationLogs.length && (
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {violationLogs.map((row) => {
                              const siswa = participantById[row.siswa_id]
                              const siswaName = siswa?.nama || 'Siswa tidak diketahui'
                              const warningCount = Number(row?.event_meta?.warning_count || 0)
                              return (
                                <div
                                  key={row.id}
                                  className="p-3 rounded-xl border border-red-200 bg-red-50/50"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-sm font-semibold text-red-700">
                                      {siswaName}
                                    </div>
                                    <div className="text-[11px] font-semibold text-red-600">
                                      {formatDateTime(row.created_at)}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-red-700 mt-1">
                                    Jenis: {getViolationTypeLabel(row.event_type)}
                                    {warningCount > 0 ? ` • Count: ${warningCount}` : ''}
                                  </div>
                                  <div className="text-[11px] text-red-600 mt-0.5">
                                    {row.event_message || '-'}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {!!participants.length && (
                    <div className="text-xs text-slate-500 pt-2">
                      Nilai dihitung otomatis oleh sistem berbasis bobot poin soal (0-100).
                      Khusus soal esai, guru memberi nilai manual melalui tombol Detail.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {detailStudent && detailSubmission && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden border border-slate-200 shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-gray-50 to-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  src={detailStudent.photo_path || detailStudent.photo_url || ''}
                  name={detailStudent.nama || 'Siswa'}
                  size={52}
                />
                <div>
                  <div className="text-lg font-bold text-slate-900">
                    Detail Jawaban • {detailStudent.nama}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    NIS: {detailStudent.nis || '-'} • Nilai: {detailSubmission.score ?? '-'}
                  </div>
                  <div className={`text-xs font-semibold mt-1 ${
                    detailReviewCompletedAt
                      ? 'text-emerald-700'
                      : detailEssayPendingCount > 0
                        ? 'text-amber-700'
                        : 'text-slate-600'
                  }`}>
                    {detailReviewCompletedAt
                      ? `Status koreksi: Selesai (${formatDateTime(detailReviewCompletedAt)})`
                      : detailEssayPendingCount > 0
                        ? `Pending koreksi esai: ${detailEssayPendingCount}`
                        : 'Semua nilai esai sudah terisi. Klik Selesai untuk finalisasi koreksi.'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleFinishEssayCorrection}
                  disabled={detailFinishingReview || Boolean(essaySavingQuestionId) || Boolean(detailReviewCompletedAt)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  {detailReviewCompletedAt ? 'Sudah Selesai' : detailFinishingReview ? 'Menyimpan...' : 'Selesai'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseStudentDetail}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  Tutup
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {detailLoading && (
                <div className="text-sm text-slate-500">Memuat detail jawaban siswa...</div>
              )}
              {!detailLoading && detailError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {detailError}
                </div>
              )}
              {!detailLoading && !detailError && !detailAnswers.length && (
                <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl px-3 py-3">
                  Belum ada jawaban untuk ditampilkan.
                </div>
              )}
              {!detailLoading && !detailError && !!detailAnswers.length && (
                <>
                  <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="text-sm font-semibold text-slate-800">Navigasi Soal</div>
                      <div className="text-[11px] text-slate-500">Hijau = ada jawaban</div>
                    </div>
                    <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
                      {detailAnswers.map((row, index) => {
                        const isActive = index === detailActiveQuestionIndex
                        const isAnswered = isDetailQuestionAnswered(row)
                        const isEssayScored = row.questionType === 'essay' && row.essayScore != null
                        return (
                          <button
                            key={row.questionId}
                            type="button"
                            onClick={() => setDetailActiveQuestionIndex(index)}
                            disabled={Boolean(essaySavingQuestionId)}
                            className={`h-9 rounded-lg text-sm font-semibold border transition ${
                              isActive
                                ? 'border-indigo-500 bg-indigo-600 text-white'
                                : isEssayScored
                                  ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                                  : isAnswered
                                    ? 'border-green-300 bg-green-100 text-green-700'
                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            } ${essaySavingQuestionId ? 'opacity-70 cursor-not-allowed' : ''}`}
                          >
                            {index + 1}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {detailActiveAnswer && (() => {
                    const row = detailActiveAnswer
                    const questionNumber = detailActiveQuestionIndex + 1
                    const isEssay = row.questionType === 'essay'
                    const answerText = String(row.essayAnswer || '').trim()
                    const isScoring = essaySavingQuestionId === row.questionId
                    const draftScore = String(essayScoreDraft[row.questionId] ?? '').trim()
                    const hasDraftScore = draftScore !== ''
                    const hasSavedEssayScore = row.essayScore != null
                    const isDraftSyncedWithSaved = hasSavedEssayScore
                      && hasDraftScore
                      && Number.isFinite(Number(draftScore))
                      && Number(draftScore) === Number(row.essayScore)
                    const essayCardTone = isEssay
                      ? isDraftSyncedWithSaved
                        ? 'border-emerald-300 bg-emerald-50/40'
                        : hasDraftScore || hasSavedEssayScore
                          ? 'border-emerald-200 bg-emerald-50/20'
                          : 'border-slate-200 bg-white'
                      : 'border-slate-200 bg-white'

                    return (
                      <div className={`border rounded-2xl p-4 ${essayCardTone}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900">
                            Soal {questionNumber} • {row.poin} poin
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            isEssay
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            {getQuestionTypeLabel(row.questionType)}
                          </span>
                        </div>
                        <div className="text-sm text-slate-700 mt-2">{row.soal}</div>
                        {row.questionImagePath && (
                          <div className="mt-3">
                            <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                              <img
                                src={getQuizImageUrl(row.questionImagePath)}
                                alt={`Gambar soal ${questionNumber}`}
                                className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                onClick={() => setPreviewMediaUrl(getQuizImageUrl(row.questionImagePath))}
                              />
                              <div className="mt-1 text-[11px] text-slate-500">
                                Ukuran: {getQuizImageSizeLabel(row.questionImagePath)}
                              </div>
                            </div>
                          </div>
                        )}

                        {!isEssay ? (
                          <div className="mt-3 space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
                              {(row.options || []).map((opt) => {
                                const isSelected = row.selectedOptionId === opt.id
                                const isCorrect = Boolean(opt.is_correct)
                                return (
                                  <div key={opt.id} className="space-y-2">
                                    <div
                                      className={`text-sm px-3 py-2 rounded-xl border min-h-[46px] ${
                                        isCorrect
                                          ? 'border-green-300 bg-green-50 text-green-700'
                                          : isSelected
                                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                            : 'border-slate-200 bg-slate-50'
                                      }`}
                                    >
                                      <span className="font-semibold mr-2">{opt.label}.</span>
                                      {opt.text}
                                    </div>
                                    {!!opt.image_path && (
                                      <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                                        <img
                                          src={getQuizImageUrl(opt.image_path)}
                                          alt={`Gambar opsi ${opt.label}`}
                                          className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                          onClick={() => setPreviewMediaUrl(getQuizImageUrl(opt.image_path))}
                                        />
                                        <div className="mt-1 text-[11px] text-slate-500">
                                          Ukuran: {getQuizImageSizeLabel(opt.image_path)}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                            <div className="w-full text-xs text-slate-500">
                              Jawaban siswa: {row.selectedOption ? `${row.selectedOption.label}. ${row.selectedOption.text}` : '-'}
                              {' • '}
                              Kunci: {row.correctOption ? `${row.correctOption.label}. ${row.correctOption.text}` : '-'}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 space-y-3">
                            <div className="text-xs text-slate-600 font-semibold">Jawaban Esai Siswa</div>
                            <div className="text-sm text-slate-700 whitespace-pre-wrap border border-slate-200 rounded-xl p-3 bg-slate-50 min-h-16">
                              {answerText || 'Siswa belum mengisi jawaban esai.'}
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                              <div>
                                <label className={`text-xs font-semibold ${hasDraftScore || hasSavedEssayScore ? 'text-emerald-700' : 'text-slate-600'}`}>
                                  Nilai Esai (min {answerText ? 1 : 0}, max {row.poin})
                                  {isDraftSyncedWithSaved ? ' • Tersimpan' : hasDraftScore ? ' • Sudah diisi' : ''}
                                </label>
                                <input
                                  type="number"
                                  min={answerText ? 1 : 0}
                                  max={row.poin}
                                  className={`mt-1 w-40 border rounded-xl px-3 py-2 text-sm ${
                                    hasDraftScore || hasSavedEssayScore
                                      ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                                      : 'border-slate-300'
                                  }`}
                                  value={essayScoreDraft[row.questionId] ?? ''}
                                  onChange={(e) => handleEssayScoreDraftChange(row.questionId, e.target.value)}
                                  disabled={isScoring}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSaveEssayScore(row)}
                                disabled={isScoring || !row.answerId}
                                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {isScoring ? 'Menyimpan...' : 'Simpan Nilai Esai'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {!!detailActiveAnswer && (
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailActiveQuestionIndex((prev) => Math.max(0, prev - 1))}
                        disabled={detailActiveQuestionIndex <= 0 || Boolean(essaySavingQuestionId)}
                        className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                      >
                        Soal Sebelumnya
                      </button>
                      <div className="text-xs text-slate-500">
                        {detailActiveQuestionIndex + 1} / {detailAnswers.length}
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetailActiveQuestionIndex((prev) => Math.min(detailAnswers.length - 1, prev + 1))}
                        disabled={detailActiveQuestionIndex >= detailAnswers.length - 1 || Boolean(essaySavingQuestionId)}
                        className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                      >
                        Soal Berikutnya
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showQuizForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 space-y-4 border border-slate-200 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">
              {editingQuizId ? 'Edit Info Quiz' : 'Buat Quiz Baru'}
            </h3>
            <div>
              <label className="text-sm font-semibold text-slate-600">Nama Quiz</label>
              <input
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={quizForm.nama}
                onChange={(e) => setQuizForm((prev) => ({ ...prev, nama: e.target.value }))}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {editingQuizId
                  ? 'Klik quiz di daftar untuk memilihnya, lalu ubah nama atau mode dari panel ini. Jadwal tetap diatur pada panel detail.'
                  : 'Jadwal belum diisi di langkah ini. Setelah quiz dibuat, kamu bisa tambah soal dulu lalu atur tanggal mulai dan deadline di panel detail quiz.'}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-sm font-semibold text-slate-600">Sistem Penilaian</label>
                <div className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 bg-slate-50 text-sm text-slate-700">
                  Poin (0-100)
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-600">Mode</label>
                <select
                  className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                  value={quizForm.mode}
                  onChange={(e) => setQuizForm((prev) => ({ ...prev, mode: e.target.value }))}
                  disabled={Boolean(editingQuizId) && !canChangeSelectedQuizMode}
                >
                  <option value="regular">Reguler</option>
                  <option value="uts">UTS</option>
                  <option value="uas">UAS</option>
                </select>
                {Boolean(editingQuizId) && !canChangeSelectedQuizMode && (
                  <div className="mt-1 text-[11px] text-amber-700">
                    Mode dikunci setelah quiz aktif atau sudah memiliki attempt siswa.
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
                <button
                  type="button"
                onClick={() => {
                  resetQuizForm()
                  setShowQuizForm(false)
                }}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuizForm}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                >
                  {editingQuizId ? 'Simpan Perubahan' : 'Simpan'}
                </button>
            </div>
          </div>
        </div>
      )}

      {showStudentPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-6xl max-h-[92vh] overflow-hidden border border-slate-200 shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-900">Preview Tampilan Siswa</div>
                <div className="text-xs text-slate-500 mt-1">
                  Review soal secara penuh sebelum quiz dijalankan
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStudentPreview(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Tutup
              </button>
            </div>

            <div className="p-5 overflow-y-auto">
              {!questions.length && (
                <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl px-4 py-4">
                  Belum ada soal untuk dipreview.
                </div>
              )}

              {!!questions.length && (
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
                  <div className="space-y-4">
                    {!!previewQuestion && (
                      <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold text-slate-900">
                            Soal {previewQuestionIndex + 1}
                            <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full border align-middle ${
                              normalizeQuestionType(previewQuestion.question_type) === 'essay'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                              {normalizeQuestionType(previewQuestion.question_type) === 'essay' ? 'Esai' : 'PG'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">{previewQuestion.poin} poin</div>
                        </div>
                        <div className="text-sm text-slate-700 mb-3">{previewQuestion.soal}</div>
                        {previewQuestion.image_path && (
                          <div className="mb-3">
                            <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                              <img
                                src={getQuizImageUrl(previewQuestion.image_path)}
                                alt={`Preview soal ${previewQuestionIndex + 1}`}
                                className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                onClick={() => setPreviewMediaUrl(getQuizImageUrl(previewQuestion.image_path))}
                              />
                              <div className="mt-1 text-[11px] text-slate-500">
                                Ukuran: {getQuizImageSizeLabel(previewQuestion.image_path)}
                              </div>
                            </div>
                          </div>
                        )}

                        {normalizeQuestionType(previewQuestion.question_type) === 'essay' ? (
                          <div>
                            <textarea
                              rows="5"
                              disabled
                              placeholder="Tulis jawaban esai Anda di sini..."
                              className="w-full border border-slate-300 rounded-2xl px-4 py-3 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
                            />
                            <div className="text-[11px] text-slate-500 mt-2">
                              Jawaban esai dinilai manual oleh guru.
                            </div>
                          </div>
                        ) : (
                          (() => {
                            const optionRows = (optionsByQuestion[previewQuestion.id] || [])
                              .slice()
                              .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
                            return (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                                  {optionRows.map((opt) => (
                                    <div key={opt.id} className="space-y-2">
                                      <div
                                        className="text-left px-4 py-3 rounded-2xl border border-slate-200 bg-white text-slate-700 min-h-[52px]"
                                      >
                                        <span className="font-semibold mr-2">{opt.label}.</span>
                                        {opt.text}
                                      </div>
                                      {!!opt.image_path && (
                                        <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                                          <img
                                            src={getQuizImageUrl(opt.image_path)}
                                            alt={`Preview opsi ${opt.label}`}
                                            className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                            onClick={() => setPreviewMediaUrl(getQuizImageUrl(opt.image_path))}
                                          />
                                          <div className="mt-1 text-[11px] text-slate-500">
                                            Ukuran: {getQuizImageSizeLabel(opt.image_path)}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })()
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewQuestionIndex((prev) => Math.max(0, prev - 1))}
                        disabled={previewQuestionIndex <= 0}
                        className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                      >
                        Soal Sebelumnya
                      </button>
                      <div className="text-xs text-slate-500">
                        {previewQuestionIndex + 1} / {questions.length}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                        disabled={previewQuestionIndex >= questions.length - 1}
                        className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                      >
                        Soal Berikutnya
                      </button>
                    </div>
                  </div>

                  <div className="h-fit border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                    <div className="text-sm font-semibold text-slate-800 mb-3">Navigasi Soal</div>
                    <div className="grid grid-cols-4 gap-2">
                      {questions.map((question, idx) => (
                        <button
                          key={question.id}
                          type="button"
                          onClick={() => setPreviewQuestionIndex(idx)}
                          className={`h-9 rounded-lg text-sm font-semibold border transition ${
                            idx === previewQuestionIndex
                              ? 'border-indigo-500 bg-indigo-600 text-white'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showQuestionForm && (
        <div className="fixed inset-0 z-50 bg-black/50 px-4 py-6 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl max-h-[calc(100vh-3rem)] overflow-y-auto bg-white rounded-3xl p-6 space-y-4 border border-slate-200 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">
              {editingQuestion ? 'Edit Soal' : 'Tambah Soal'}
            </h3>
            <div>
              <label className="text-sm font-semibold text-slate-600">Jenis Soal</label>
              <select
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={questionForm.question_type}
                onChange={(e) => setQuestionForm((prev) => ({ ...prev, question_type: e.target.value }))}
              >
                <option value="mcq">Pilihan Ganda</option>
                <option value="essay">Esai</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-600">Soal</label>
              <textarea
                rows="3"
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={questionForm.soal}
                onChange={(e) => setQuestionForm((prev) => ({ ...prev, soal: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-600">
                Gambar Soal (JPG/PNG, maks {Math.floor(QUIZ_IMAGE_MAX_BYTES / 1024)}KB)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleQuestionImageUpload(file)
                    e.target.value = ''
                  }}
                  className="text-xs"
                  disabled={questionImageUploading}
                />
                {questionImageUploading && (
                  <span className="text-xs text-indigo-600 font-semibold">Upload gambar soal...</span>
                )}
                {!!questionForm.image_path && (
                  <button
                    type="button"
                    onClick={() => { void handleRemoveQuestionImage() }}
                    className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Hapus Gambar Soal
                  </button>
                )}
              </div>
              {!!questionForm.image_path && (
                <div>
                  <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <img
                      src={getQuizImageUrl(questionForm.image_path)}
                      alt="Preview gambar soal"
                      className="block max-h-52 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                      onClick={() => setPreviewMediaUrl(getQuizImageUrl(questionForm.image_path))}
                    />
                    <div className="mt-1 text-[11px] text-slate-500">
                      Ukuran: {getQuizImageSizeLabel(questionForm.image_path)}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-600">Poin Soal</label>
              <select
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={questionForm.poin}
                onChange={(e) => setQuestionForm((prev) => ({ ...prev, poin: Number(e.target.value) }))}
              >
                {POINT_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p} poin</option>
                ))}
              </select>
            </div>
            <div className={`text-xs border rounded-xl px-3 py-2 ${
              projectedQuestionPoints > QUIZ_MAX_POINTS
                ? 'text-red-700 bg-red-50 border-red-200'
                : 'text-slate-600 bg-slate-50 border-slate-200'
            }`}>
              Total poin setelah simpan: <span className="font-semibold">{projectedQuestionPoints}</span> / {QUIZ_MAX_POINTS}
              {projectedQuestionPoints > QUIZ_MAX_POINTS && ' (melewati batas maksimal)'}
            </div>
            {normalizeQuestionType(questionForm.question_type) === 'mcq' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {['A', 'B', 'C', 'D'].map((label) => (
                    <div key={label}>
                      <label className="text-xs font-semibold text-slate-500">Pilihan {label}</label>
                      <input
                        className={`mt-1 w-full border rounded-xl px-4 py-3 ${
                          questionForm.correct === label ? 'border-green-400 bg-green-50' : 'border-slate-200'
                        }`}
                        value={questionForm.options[label]}
                        onChange={(e) =>
                          setQuestionForm((prev) => ({
                            ...prev,
                            options: { ...prev.options, [label]: e.target.value }
                          }))
                        }
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void handleOptionImageUpload(label, file)
                            e.target.value = ''
                          }}
                          className="text-xs"
                          disabled={Boolean(optionImageUploading[label])}
                        />
                        {optionImageUploading[label] && (
                          <span className="text-xs text-indigo-600 font-semibold">Upload...</span>
                        )}
                        {!!questionForm.option_images?.[label] && (
                          <button
                            type="button"
                            onClick={() => { void handleRemoveOptionImage(label) }}
                            className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            Hapus Gambar
                          </button>
                        )}
                      </div>
                      {!!questionForm.option_images?.[label] && (
                        <div className="mt-2">
                          <div className="inline-flex max-w-full flex-col rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                            <img
                              src={getQuizImageUrl(questionForm.option_images[label])}
                              alt={`Preview opsi ${label}`}
                              className="block max-h-24 w-auto max-w-full object-contain rounded-md cursor-zoom-in"
                              onClick={() => setPreviewMediaUrl(getQuizImageUrl(questionForm.option_images[label]))}
                            />
                            <div className="mt-1 text-[11px] text-slate-500">
                              Ukuran: {getQuizImageSizeLabel(questionForm.option_images[label])}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-600">Jawaban Benar</label>
                  <select
                    className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                    value={questionForm.correct}
                    onChange={(e) => setQuestionForm((prev) => ({ ...prev, correct: e.target.value }))}
                  >
                    {['A', 'B', 'C', 'D'].map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Soal esai tidak memakai opsi A/B/C/D. Jawaban siswa akan dinilai manual oleh guru.
              </div>
            )}
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/70">
              <div className="text-sm font-semibold text-slate-800 mb-3">Preview Soal (Tampilan Siswa)</div>
              <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-slate-900">
                    Soal {editingQuestionDisplayNumber}
                    <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full border align-middle ${
                      normalizeQuestionType(questionForm.question_type) === 'essay'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}>
                      {normalizeQuestionType(questionForm.question_type) === 'essay' ? 'Esai' : 'PG'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">{questionForm.poin} poin</div>
                </div>
                <div className="text-sm text-slate-700 mb-3">
                  {questionForm.soal.trim() || 'Soal belum diisi'}
                </div>
                {!!questionForm.image_path && (
                  <div className="mb-3">
                    <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <img
                        src={getQuizImageUrl(questionForm.image_path)}
                        alt="Preview gambar soal siswa"
                        className="block max-h-52 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                        onClick={() => setPreviewMediaUrl(getQuizImageUrl(questionForm.image_path))}
                      />
                      <div className="mt-1 text-[11px] text-slate-500">
                        Ukuran: {getQuizImageSizeLabel(questionForm.image_path)}
                      </div>
                    </div>
                  </div>
                )}
                {normalizeQuestionType(questionForm.question_type) === 'essay' ? (
                  <div>
                    <textarea
                      rows="4"
                      disabled
                      placeholder="Tulis jawaban esai Anda di sini..."
                      className="w-full border border-slate-300 rounded-2xl px-4 py-3 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
                    />
                    <div className="text-[11px] text-slate-500 mt-2">
                      Jawaban esai dinilai manual oleh guru.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                      {['A', 'B', 'C', 'D'].map((label) => {
                        const optionText = questionForm.options?.[label] || ''
                        const optionImagePath = questionForm.option_images?.[label] || ''
                        const isCorrect = questionForm.correct === label
                        return (
                          <div key={label} className="space-y-2">
                            <div
                              className={`text-left px-4 py-3 rounded-2xl border min-h-[52px] ${
                                isCorrect
                                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                                  : 'border-slate-200 bg-white text-slate-700'
                              }`}
                            >
                              <span className="font-semibold mr-2">{label}.</span>
                              {optionText || <span className="text-slate-400">Opsi belum diisi</span>}
                            </div>
                            {!!optionImagePath && (
                              <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                                <img
                                  src={getQuizImageUrl(optionImagePath)}
                                  alt={`Preview gambar opsi ${label}`}
                                  className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                  onClick={() => setPreviewMediaUrl(getQuizImageUrl(optionImagePath))}
                                />
                                <div className="mt-1 text-[11px] text-slate-500">
                                  Ukuran: {getQuizImageSizeLabel(optionImagePath)}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuestionForm(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveQuestion}
                disabled={projectedQuestionPoints > QUIZ_MAX_POINTS}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Simpan Soal
              </button>
            </div>
          </div>
        </div>
      )}

      {previewMediaUrl && (
        <FilePreviewModal
          fileUrl={previewMediaUrl}
          onClose={() => setPreviewMediaUrl('')}
        />
      )}
    </div>
  )
}

