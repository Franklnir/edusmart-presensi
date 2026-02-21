import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QUIZ_MEDIA_BUCKET, supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import ProfileAvatar from '../../components/ProfileAvatar'
import FilePreviewModal from '../../components/FilePreviewModal'

const POINT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30]
const QUIZ_MAX_POINTS = 100
const QUIZ_IMAGE_MAX_BYTES = 70 * 1024
const QUIZ_IMAGE_ALLOWED_EXT = ['jpg', 'jpeg', 'png']
const QUIZ_IMAGE_ALLOWED_MIME = ['image/jpeg', 'image/png']
const MONTH_FILTER_ALL = ''
const MONTH_FILTER_THIS = '__this_month'
const MONTH_FILTER_LAST_12 = '__last_12_months'

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const normalizeMapel = (v) => (v || '').toString().trim()

const getFileExtension = (name = '') => {
  const normalized = String(name || '').split('?')[0].toLowerCase()
  const parts = normalized.split('.')
  if (parts.length < 2) return ''
  return parts.pop() || ''
}

const isSupportedQuizImage = (file) => {
  if (!file) return false
  const ext = getFileExtension(file.name || '')
  const mime = String(file.type || '').toLowerCase()
  return QUIZ_IMAGE_ALLOWED_EXT.includes(ext) && QUIZ_IMAGE_ALLOWED_MIME.includes(mime)
}

const formatBytesLabel = (bytes) => {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  const kb = value / 1024
  if (kb < 1024) return `${Math.round(kb * 10) / 10} KB`
  const mb = kb / 1024
  return `${Math.round(mb * 100) / 100} MB`
}

const safeDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

const toMinuteDate = (value) => {
  const d = safeDate(value)
  if (!d) return null
  d.setSeconds(0, 0)
  return d
}

const getNowLocalInput = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16)
}

const toLocalInput = (value) => {
  const d = safeDate(value)
  if (!d) return ''
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16)
}

const formatRemaining = (seconds) => {
  if (seconds == null) return '-'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const parts = []
  if (h > 0) parts.push(String(h).padStart(2, '0'))
  parts.push(String(m).padStart(2, '0'))
  parts.push(String(r).padStart(2, '0'))
  return parts.join(':')
}

const formatDurationText = (startedAtValue, endedAtValue = new Date()) => {
  const startedAt = safeDate(startedAtValue)
  const endedAt = safeDate(endedAtValue) || new Date()
  if (!startedAt || !endedAt || endedAt < startedAt) return '-'

  const diffSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
  if (diffSeconds < 60) return '< 1 menit'

  const totalMinutes = Math.floor(diffSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours} jam ${minutes} menit`
  if (hours > 0) return `${hours} jam`
  return `${totalMinutes} menit`
}

const normalizeMode = (quiz) => {
  const raw = (quiz?.mode || '').toString().toLowerCase()
  if (raw === 'regular') return 'regular'
  if (raw === 'uts') return 'uts'
  if (raw === 'uas') return 'uas'
  if (raw === 'ulangan') return 'uts'
  return quiz?.is_live ? 'uts' : 'regular'
}

const getModeLabel = (quiz) => {
  const mode = normalizeMode(quiz)
  if (mode === 'uts') return 'Mode UTS'
  if (mode === 'uas') return 'Mode UAS'
  return 'Mode Reguler'
}

const normalizeQuestionType = (value) => {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'essay') return 'essay'
  return 'mcq'
}

const getQuestionTypeLabel = (value) => (
  normalizeQuestionType(value) === 'essay' ? 'Esai' : 'Pilihan Ganda'
)

const getQuizEndAt = (quiz) => {
  const mode = normalizeMode(quiz)
  if (mode === 'regular') return safeDate(quiz?.deadline_at)
  const startsAt = safeDate(quiz?.live_started_at || quiz?.starts_at)
  const duration = Number(quiz?.duration_minutes || 0)
  if (!startsAt || duration <= 0) return safeDate(quiz?.deadline_at)
  return new Date(startsAt.getTime() + duration * 60000)
}

const getRemainingSeconds = (quiz, now) => {
  const endAt = getQuizEndAt(quiz)
  if (!endAt) return null
  return Math.floor((endAt.getTime() - now.getTime()) / 1000)
}

const getQuizStatus = (quiz, now = new Date()) => {
  const startsAt = safeDate(quiz?.starts_at)
  const endAt = getQuizEndAt(quiz)

  if (!startsAt) {
    return { label: 'Belum dijadwalkan', tone: 'bg-yellow-100 text-yellow-700 border-yellow-200', kind: 'draft' }
  }

  if (endAt && now > endAt) {
    return { label: 'Berakhir', tone: 'bg-red-100 text-red-700 border-red-200', kind: 'expired' }
  }

  if (now < startsAt) {
    return { label: 'Belum dimulai', tone: 'bg-yellow-100 text-yellow-700 border-yellow-200', kind: 'scheduled' }
  }

  return { label: 'Sedang berlangsung', tone: 'bg-green-100 text-green-700 border-green-200', kind: 'active' }
}

const getQuizCreatedAtMs = (quiz) => {
  const createdAt = safeDate(quiz?.created_at)
  return createdAt ? createdAt.getTime() : 0
}

const compareQuizByDeadlineUrgency = (a, b, now = new Date()) => {
  const endA = getQuizEndAt(a)
  const endB = getQuizEndAt(b)
  const hasEndA = Boolean(endA)
  const hasEndB = Boolean(endB)
  const expiredA = hasEndA && endA.getTime() < now.getTime()
  const expiredB = hasEndB && endB.getTime() < now.getTime()

  if (expiredA !== expiredB) return expiredA ? 1 : -1
  if (hasEndA !== hasEndB) return hasEndA ? -1 : 1
  if (hasEndA && hasEndB) {
    const deadlineDiff = endA.getTime() - endB.getTime()
    if (deadlineDiff !== 0) return deadlineDiff
  }

  const createdDiff = getQuizCreatedAtMs(b) - getQuizCreatedAtMs(a)
  if (createdDiff !== 0) return createdDiff
  return String(a?.id || '').localeCompare(String(b?.id || ''), 'id')
}

const sortQuizzesByPriority = (rows, now = new Date()) => {
  const list = [...(rows || [])]
  if (list.length <= 1) return list

  const newest = [...list].sort((a, b) => {
    const createdDiff = getQuizCreatedAtMs(b) - getQuizCreatedAtMs(a)
    if (createdDiff !== 0) return createdDiff
    return compareQuizByDeadlineUrgency(a, b, now)
  })[0]

  const rest = list
    .filter((row) => row?.id !== newest?.id)
    .sort((a, b) => compareQuizByDeadlineUrgency(a, b, now))

  return newest ? [newest, ...rest] : rest
}

const getQuizCountdownMeta = (quiz, status, now = new Date()) => {
  if (!quiz || !status) return null
  if (status.kind === 'active') {
    const endAt = getQuizEndAt(quiz)
    if (!endAt) return null
    return {
      label: 'Sisa waktu',
      seconds: Math.floor((endAt.getTime() - now.getTime()) / 1000),
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800'
    }
  }
  if (status.kind === 'scheduled') {
    const startsAt = safeDate(quiz?.starts_at)
    if (!startsAt) return null
    return {
      label: 'Mulai dalam',
      seconds: Math.floor((startsAt.getTime() - now.getTime()) / 1000),
      tone: 'border-amber-200 bg-amber-50 text-amber-800'
    }
  }
  return null
}

const getQuizMutationMeta = (quiz) => {
  const createdAt = safeDate(quiz?.created_at)
  const updatedAt = safeDate(quiz?.updated_at)
  if (!createdAt || !updatedAt) {
    return {
      label: 'Baru',
      tone: 'bg-blue-100 text-blue-700 border-blue-200'
    }
  }

  const edited = updatedAt.getTime() - createdAt.getTime() > 60 * 1000
  if (edited) {
    return {
      label: 'Diedit',
      tone: 'bg-amber-100 text-amber-700 border-amber-200'
    }
  }

  return {
    label: 'Baru',
    tone: 'bg-blue-100 text-blue-700 border-blue-200'
  }
}

const getQuizMonthKey = (quiz) => {
  const baseDate = safeDate(quiz?.starts_at || quiz?.deadline_at || quiz?.created_at)
  if (!baseDate) return ''
  const year = baseDate.getFullYear()
  const month = String(baseDate.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const getMonthKeyFromDate = (dateValue) => {
  const date = safeDate(dateValue)
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const getLastNMonthKeys = (nowValue = new Date(), count = 12) => {
  const now = safeDate(nowValue) || new Date()
  const set = new Set()
  const base = new Date(now.getFullYear(), now.getMonth(), 1)
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    set.add(getMonthKeyFromDate(d))
  }
  return set
}

const formatQuizMonthLabel = (monthKey) => {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return String(monthKey || '')
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

const getViolationTypeLabel = (eventType) => {
  const type = String(eventType || '').trim().toLowerCase()
  if (type === 'fullscreen_required') return 'Fullscreen wajib'
  if (type === 'page_hidden') return 'Keluar halaman'
  if (type === 'window_blur') return 'Pindah tab/aplikasi'
  if (type === 'fullscreen_exit') return 'Fullscreen ditutup'
  if (type === 'blocked_shortcut') return 'Shortcut browser'
  if (type === 'blocked_key') return 'Tombol diblok'
  if (type === 'clipboard_or_context') return 'Copy/klik kanan'
  if (type === 'focus_lost') return 'Fokus hilang'
  if (type === 'screenshot_attempt') return 'Screenshot'
  if (type === 'manual_submit_after_warning') return 'Keluar setelah peringatan'
  return 'Peringatan'
}

const ONLINE_ACTIVE_SECONDS = 120

export default function GuruQuiz() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

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
  const [questionImageUploading, setQuestionImageUploading] = useState(false)
  const [optionImageUploading, setOptionImageUploading] = useState({})
  const [imageSizeByPath, setImageSizeByPath] = useState({})
  const [imageSizeLoadingByPath, setImageSizeLoadingByPath] = useState({})
  const imageSizeByPathRef = useRef({})
  const imageSizeLoadingRef = useRef(new Set())

  const orderedQuizList = useMemo(() => (
    sortQuizzesByPriority(quizList, nowTick)
  ), [quizList, nowTick])

  const monthOptions = useMemo(() => {
    const values = new Set()
    ;(orderedQuizList || []).forEach((quiz) => {
      const monthKey = getQuizMonthKey(quiz)
      if (monthKey) values.add(monthKey)
    })
    return Array.from(values).sort((a, b) => b.localeCompare(a, 'id'))
  }, [orderedQuizList])

  const currentMonthKey = useMemo(() => (
    getMonthKeyFromDate(nowTick)
  ), [nowTick])

  const last12MonthKeySet = useMemo(() => (
    getLastNMonthKeys(nowTick, 12)
  ), [nowTick])

  const filteredQuizList = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) {
      return orderedQuizList.filter((quiz) => getQuizMonthKey(quiz) === currentMonthKey)
    }
    if (selectedMonth === MONTH_FILTER_LAST_12) {
      return orderedQuizList.filter((quiz) => last12MonthKeySet.has(getQuizMonthKey(quiz)))
    }
    if (!selectedMonth) return orderedQuizList
    return orderedQuizList.filter((quiz) => getQuizMonthKey(quiz) === selectedMonth)
  }, [orderedQuizList, selectedMonth, currentMonthKey, last12MonthKeySet])

  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) return `Bulan ini (${formatQuizMonthLabel(currentMonthKey)})`
    if (selectedMonth === MONTH_FILTER_LAST_12) return '12 bulan terakhir'
    if (!selectedMonth) return 'Semua bulan'
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
    if (selectedMonth === MONTH_FILTER_THIS || selectedMonth === MONTH_FILTER_LAST_12) return
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
          lastAt: null,
          lastType: '',
          lastMessage: ''
        }
      }

      const current = map[submissionId]
      current.count += 1
      const prevDate = safeDate(current.lastAt)
      const rowDate = safeDate(row?.created_at)
      if (!prevDate || (rowDate && rowDate > prevDate)) {
        current.lastAt = row?.created_at || null
        current.lastType = row?.event_type || ''
        current.lastMessage = row?.event_message || ''
      }
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
        const { data } = await supabase.from('jadwal').select('*').eq('guru_id', user.id)
        setJadwal(data || [])
      } catch (err) {
        console.error(err)
      }
    }
    loadJadwal()
  }, [user?.id])

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
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .eq('kelas_id', selectedKelas)
      .eq('mapel', selectedMapel)
      .order('created_at', { ascending: false })

    const rows = data || []
    setQuizList(rows)
    const sortedRows = sortQuizzesByPriority(rows, new Date())
    if (sortedRows.length && !selectedQuizId) setSelectedQuizId(sortedRows[0].id)
    if (!rows.length) setSelectedQuizId('')

    if (!rows.length) {
      setQuizStatsById({})
      return
    }

    const quizIds = rows.map((q) => q.id)
    const { data: studentRows } = await supabase
      .from('profiles')
      .select('id')
      .eq('kelas', selectedKelas)
      .eq('role', 'siswa')
    const totalStudentsByClass = (studentRows || []).length

    let submissionList = []
    try {
      const { data, error } = await supabase
        .from('quiz_submissions')
        .select('id, quiz_id, siswa_id, status, essay_review_completed_at')
        .in('quiz_id', quizIds)
      if (error) throw error
      submissionList = data || []
    } catch (err) {
      if (/essay_review_completed_at/i.test(String(err?.message || ''))) {
        const { data } = await supabase
          .from('quiz_submissions')
          .select('id, quiz_id, siswa_id, status')
          .in('quiz_id', quizIds)
        submissionList = (data || []).map((row) => ({ ...row, essay_review_completed_at: null }))
      } else {
        throw err
      }
    }
    const submissionById = new Map(submissionList.map((sub) => [sub.id, sub]))

    const summary = {}
    rows.forEach((q) => {
      summary[q.id] = {
        total_students: totalStudentsByClass,
        started_count: 0,
        finished_count: 0,
        not_started_count: totalStudentsByClass,
        essay_question_count: 0,
        essay_answered_count: 0,
        essay_graded_count: 0,
        essay_pending_count: 0,
        essay_student_graded_count: 0,
        essay_student_pending_count: 0
      }
    })

    const startedSetByQuiz = {}
    submissionList.forEach((sub) => {
      if (!summary[sub.quiz_id]) return
      if (!startedSetByQuiz[sub.quiz_id]) startedSetByQuiz[sub.quiz_id] = new Set()
      startedSetByQuiz[sub.quiz_id].add(sub.siswa_id)
      if (sub.status === 'finished') {
        summary[sub.quiz_id].finished_count += 1
      }
    })

    Object.keys(summary).forEach((quizId) => {
      const startedCount = startedSetByQuiz[quizId] ? startedSetByQuiz[quizId].size : 0
      summary[quizId].started_count = startedCount
      summary[quizId].not_started_count = Math.max(0, summary[quizId].total_students - startedCount)
    })

    const { data: questionRows } = await supabase
      .from('quiz_questions')
      .select('id, quiz_id, question_type')
      .in('quiz_id', quizIds)

    const essayQuestionToQuiz = {}
    const quizIdsWithEssay = new Set()
    ;(questionRows || []).forEach((row) => {
      const quizId = row?.quiz_id
      if (!quizId || !summary[quizId]) return
      if (normalizeQuestionType(row?.question_type) !== 'essay') return
      summary[quizId].essay_question_count += 1
      quizIdsWithEssay.add(quizId)
      essayQuestionToQuiz[row.id] = quizId
    })

    const essayQuestionIds = Object.keys(essayQuestionToQuiz)
    if (essayQuestionIds.length) {
      const { data: answerRows } = await supabase
        .from('quiz_answers')
        .select('submission_id, question_id, essay_answer, essay_score')
        .in('question_id', essayQuestionIds)

      ;(answerRows || []).forEach((answerRow) => {
        const submission = submissionById.get(answerRow?.submission_id)
        if (!submission || submission.status !== 'finished') return

        const quizId = essayQuestionToQuiz[answerRow?.question_id]
        if (!quizId || !summary[quizId]) return

        const essayText = String(answerRow?.essay_answer || '').trim()
        if (!essayText) return

        summary[quizId].essay_answered_count += 1
        if (answerRow?.essay_score == null) {
          summary[quizId].essay_pending_count += 1
        } else {
          summary[quizId].essay_graded_count += 1
        }
      })
    }

    submissionList.forEach((submission) => {
      const quizId = submission?.quiz_id
      if (!quizId || !summary[quizId]) return
      if (!quizIdsWithEssay.has(quizId)) return
      if (submission?.status !== 'finished') return

      if (submission?.essay_review_completed_at) {
        summary[quizId].essay_student_graded_count += 1
      } else {
        summary[quizId].essay_student_pending_count += 1
      }
    })

    setQuizStatsById(summary)
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
  }, [selectedKelas, selectedMapel, quizRealtimeTick])

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
      const { data: questionRows } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', selectedQuizId)
        .order('nomor', { ascending: true })

      const questionIds = (questionRows || []).map((q) => q.id)
      let optionRows = []
      if (questionIds.length) {
        const { data } = await supabase.from('quiz_options').select('*').in('question_id', questionIds)
        optionRows = data || []
      }

      const byQuestion = {}
      optionRows.forEach((opt) => {
        if (!byQuestion[opt.question_id]) byQuestion[opt.question_id] = []
        byQuestion[opt.question_id].push(opt)
      })

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

      const { data: submissionRows } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('quiz_id', selectedQuizId)

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
        try {
          const { data: essayRows, error: essayError } = await supabase
            .from('quiz_answers')
            .select('submission_id, question_id, essay_answer, essay_score')
            .in('question_id', essayQuestionIds)
            .in('submission_id', submissionIds)

          if (!essayError) {
            ;(essayRows || []).forEach((row) => {
              const submissionId = row?.submission_id
              if (!submissionId || !essayProgressMap[submissionId]) return
              const answerText = String(row?.essay_answer || '').trim()
              if (!answerText) return
              essayProgressMap[submissionId].answeredCount += 1
              if (row?.essay_score == null) {
                essayProgressMap[submissionId].pendingCount += 1
              } else {
                essayProgressMap[submissionId].gradedCount += 1
              }
            })
          }
        } catch {
          // Abaikan error progress koreksi agar halaman tetap bisa dibuka.
        }
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

      setQuestions(questionRows || [])
      setOptionsByQuestion(byQuestion)
      setParticipants(peserta)
      setRetakeLogs(historyRows)
      setViolationLogs(warningRows)
      setPresenceByStudent(presenceMap)
      setEssayProgressBySubmission(essayProgressMap)
    } catch (err) {
      setViolationLogs([])
      setPresenceByStudent({})
      setEssayProgressBySubmission({})
      pushToast('error', err?.message || 'Gagal memuat detail quiz')
    }
  }

  useEffect(() => {
    loadQuizDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuizId, detailRealtimeTick])

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

  const resetQuizForm = () => {
    setQuizForm({
      nama: '',
      mode: 'regular'
    })
  }

  const handleCreateQuiz = async () => {
    if (!selectedKelas || !selectedMapel) {
      pushToast('error', 'Pilih kelas dan mapel terlebih dahulu')
      return
    }
    if (!quizForm.nama.trim()) {
      pushToast('error', 'Nama quiz wajib diisi')
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

  const handleSaveSchedule = async () => {
    if (!selectedQuiz) return
    if (!questions.length) {
      pushToast('error', 'Tambahkan minimal 1 soal sebelum mengatur jadwal')
      return
    }
    if (!scheduleForm.starts_at) {
      pushToast('error', 'Tanggal mulai wajib diisi')
      return
    }

    const startsAt = toMinuteDate(scheduleForm.starts_at)
    if (!startsAt) {
      pushToast('error', 'Tanggal mulai tidak valid')
      return
    }
    const existingStart = toMinuteDate(selectedQuiz.starts_at)
    const hasStartChanged = !existingStart || existingStart.getTime() !== startsAt.getTime()
    const nowMinute = toMinuteDate(new Date())
    if (hasStartChanged && startsAt < nowMinute) {
      pushToast('error', 'Tanggal mulai tidak boleh di masa lalu')
      return
    }

    const mode = normalizeMode(selectedQuiz)
    const payload = {
      updated_at: new Date().toISOString()
    }
    if (hasStartChanged) {
      payload.starts_at = startsAt.toISOString()
    }

    if (mode === 'regular') {
      if (!scheduleForm.deadline_at) {
        pushToast('error', 'Tanggal selesai wajib diisi')
        return
      }
      const deadlineAt = toMinuteDate(scheduleForm.deadline_at)
      if (!deadlineAt || deadlineAt <= startsAt) {
        pushToast('error', 'Tanggal selesai harus setelah tanggal mulai')
        return
      }
      payload.deadline_at = deadlineAt.toISOString()
      payload.is_live = false
      payload.is_active = true
      payload.live_started_at = null
      payload.duration_minutes = null
    } else {
      const duration = Number(scheduleForm.duration_minutes || 0)
      if (!Number.isFinite(duration) || duration < 10) {
        pushToast('error', 'Durasi ujian minimal 10 menit')
        return
      }
      payload.is_live = true
      payload.is_active = true
      payload.duration_minutes = Math.round(duration)
      payload.live_started_at = startsAt.toISOString()
      payload.deadline_at = new Date(startsAt.getTime() + Math.round(duration) * 60000).toISOString()
    }

    try {
      setLoading(true)
      const { error } = await supabase.from('quizzes').update(payload).eq('id', selectedQuiz.id)
      if (error) throw error
      pushToast('success', 'Jadwal quiz berhasil disimpan')
      await loadQuizzes()
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan jadwal quiz')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleResultVisibility = async () => {
    if (!selectedQuiz) return
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
      const rows = (questions || []).map((question) => {
        const answer = answerByQuestionId.get(question.id) || null
        const questionType = normalizeQuestionType(question?.question_type)
        const options = (optionsByQuestion[question.id] || [])
          .slice()
          .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
        const selectedOption = options.find((opt) => opt.id === answer?.option_id) || null
        const correctOption = options.find((opt) => Boolean(opt?.is_correct)) || null

        return {
          questionId: question.id,
          nomor: question.nomor,
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

  const startInputMin = useMemo(() => {
    if (!selectedQuiz) return getNowLocalInput()
    const existingStart = safeDate(selectedQuiz.starts_at)
    if (existingStart && existingStart < nowTick) {
      return toLocalInput(existingStart)
    }
    return getNowLocalInput()
  }, [selectedQuiz, nowTick])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-indigo-500 to-blue-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-1">Kelola Quiz</h1>
                <p className="text-slate-600 text-base">Atur quiz untuk kelas yang Anda ampu dengan jadwal terstruktur.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="bg-gradient-to-r from-gray-50 to-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Guru Aktif</div>
                <div className="font-semibold text-slate-800">{user?.email || '-'}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowQuizForm(true)}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold hover:from-indigo-700 hover:to-blue-700 transition-all shadow-sm hover:shadow-md"
              >
                + Buat Quiz
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
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
                <option value={MONTH_FILTER_ALL}>Semua bulan</option>
                <option value={MONTH_FILTER_THIS}>Bulan ini</option>
                <option value={MONTH_FILTER_LAST_12}>12 bulan terakhir</option>
                {monthOptions.map((monthKey) => (
                  <option key={monthKey} value={monthKey}>
                    {formatQuizMonthLabel(monthKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Daftar Quiz</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{filteredQuizList.length} quiz tersedia</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                  {selectedMapel || 'Semua mapel'}
                </span>
                <span className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-xs font-semibold">
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
                const isNewestCard = filteredQuizList[0]?.id === q.id
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuizId(q.id)}
                    className={`w-full text-left border-2 rounded-2xl p-4 transition-all duration-300 ${
                      status.kind === 'expired'
                        ? selectedQuizId === q.id
                          ? 'border-red-400 bg-gradient-to-r from-red-100 to-rose-100 shadow-sm shadow-red-100/60'
                          : 'border-red-300 bg-gradient-to-r from-red-100 to-rose-100 hover:border-red-400 hover:shadow-sm'
                        : selectedQuizId === q.id
                          ? 'border-indigo-400 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-sm shadow-indigo-100/60'
                          : status.kind === 'active'
                            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/90 to-green-50/50 hover:border-emerald-300 hover:shadow-sm'
                            : 'border-amber-200 bg-gradient-to-r from-amber-50/90 to-yellow-50/40 hover:border-amber-300 hover:shadow-sm'
                    } ${correctionBorder}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900 text-base">{q.nama}</div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <span className={`inline-flex text-[11px] px-2 py-0.5 rounded-full border ${status.tone}`}>
                          {status.label}
                        </span>
                        {isNewestCard && (
                          <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full border bg-indigo-100 text-indigo-700 border-indigo-200">
                            Terbaru dibuat
                          </span>
                        )}
                        <span className={`inline-flex text-[11px] px-2 py-0.5 rounded-full border ${mutationMeta.tone}`}>
                          {mutationMeta.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{getModeLabel(q)}</div>
                    <div className="text-[11px] text-slate-500 mt-2">
                      Mulai: {q.starts_at ? formatDateTime(q.starts_at) : '-'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Selesai: {q.deadline_at ? formatDateTime(q.deadline_at) : '-'}
                    </div>
                    <div className="mt-3 text-[11px] text-slate-600 flex flex-wrap gap-2">
                      <span className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200">Total: {stats.total_students ?? 0}</span>
                      <span className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200">Belum: {stats.not_started_count ?? 0}</span>
                      {essayQuestionCount > 0 && (
                        <span className="px-2 py-1 rounded-lg bg-white/80 border border-amber-200 text-amber-700">
                          Belum dikoreksi: {essayStudentPendingCount}
                        </span>
                      )}
                      {essayQuestionCount > 0 && (
                        <span className="px-2 py-1 rounded-lg bg-white/80 border border-emerald-200 text-emerald-700">
                          Sudah dikoreksi: {essayStudentGradedCount}
                        </span>
                      )}
                    </div>
                    <div className={`mt-2 inline-flex text-[11px] px-2.5 py-1 rounded-lg border font-semibold ${correctionTone}`}>
                      {correctionLabel}
                    </div>
                    <div className={`mt-2 inline-flex text-[11px] px-2.5 py-1 rounded-lg border font-semibold ${
                      resultVisible
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}>
                      Hasil ke siswa: {resultVisible ? 'Aktif' : 'Nonaktif'}
                    </div>
                    {countdownMeta && (
                      <div className={`mt-2 rounded-xl border px-3 py-2 ${countdownMeta.tone}`}>
                        <div className="text-[11px] font-semibold uppercase tracking-wide">{countdownMeta.label}</div>
                        <div className="text-base font-black leading-none mt-1">
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
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{selectedQuiz.nama}</h3>
                      <p className="text-sm text-slate-500">{getModeLabel(selectedQuiz)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {selectedStatus && (
                      <span className={`inline-flex w-fit text-xs px-3 py-1 rounded-full border ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    )}
                    <span className={`inline-flex w-fit text-[11px] px-2.5 py-1 rounded-full border ${getQuizMutationMeta(selectedQuiz).tone}`}>
                      {getQuizMutationMeta(selectedQuiz).label}
                    </span>
                    <span className={`inline-flex w-fit text-[11px] px-2.5 py-1 rounded-full border ${
                      selectedQuiz?.result_visible_to_students
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}>
                      Hasil ke siswa: {selectedQuiz?.result_visible_to_students ? 'Aktif' : 'Nonaktif'}
                    </span>
                    {selectedCountdownMeta && (
                      <div className={`rounded-xl border px-3 py-2 text-right ${selectedCountdownMeta.tone}`}>
                        <div className="text-[11px] font-semibold uppercase tracking-wide">
                          {selectedCountdownMeta.label}
                        </div>
                        <div className="text-lg font-black leading-none mt-0.5">
                          {formatRemaining(selectedCountdownMeta.seconds)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-slate-700">
                    Total siswa mapel: <span className="font-semibold text-slate-900">{totalStudents}</span>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 text-slate-700">
                    Sudah mengerjakan: <span className="font-semibold text-slate-900">{joinedCount}</span>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 text-slate-700">
                    Belum mengerjakan: <span className="font-semibold text-slate-900">{notStartedCount}</span>
                  </div>
                  <div className={`px-3 py-2 rounded-xl border ${
                    selectedEssayStudentPendingCount > 0
                      ? 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200 text-red-700'
                      : selectedEssayQuestionCount > 0
                        ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200 text-emerald-700'
                        : 'bg-gradient-to-r from-slate-50 to-gray-50 border-slate-200 text-slate-600'
                  }`}>
                    Status koreksi: <span className="font-semibold">
                      {selectedEssayQuestionCount === 0
                        ? 'Tanpa esai'
                        : `Belum ${selectedEssayStudentPendingCount} • Sudah ${selectedEssayStudentGradedCount}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-emerald-600 rounded-full"></div>
                    <h3 className="text-lg font-bold text-slate-900">Jadwal Quiz</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
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
                      className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      min={startInputMin}
                      value={scheduleForm.starts_at}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, starts_at: e.target.value }))}
                    />
                  </div>
                  {normalizeMode(selectedQuiz) === 'regular' ? (
                    <div>
                      <label className="text-sm font-semibold text-slate-600">Tanggal Selesai</label>
                      <input
                        type="datetime-local"
                        className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        min={scheduleForm.starts_at || getNowLocalInput()}
                        value={scheduleForm.deadline_at}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, deadline_at: e.target.value }))}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm font-semibold text-slate-600">Durasi (menit)</label>
                      <input
                        type="number"
                        min="10"
                        className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        value={scheduleForm.duration_minutes}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, duration_minutes: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/70">
                  Alur: buat soal dulu, lalu atur jadwal. Setelah jadwal aktif, siswa bisa mulai quiz otomatis.
                </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
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
                      disabled={!selectedQuiz || resultVisibilitySaving}
                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 ${
                        selectedQuiz?.result_visible_to_students
                          ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {resultVisibilitySaving
                        ? 'Menyimpan...'
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
                      className="px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-semibold hover:bg-indigo-50 disabled:opacity-60"
                    >
                      Preview Siswa
                    </button>
                    <button
                      type="button"
                      onClick={() => openQuestionForm()}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      + Tambah Soal
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {questions.length === 0 && (
                    <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                      Belum ada soal.
                    </div>
                  )}
                  {questions.map((q) => (
                    <div key={q.id} className="border border-slate-200 rounded-2xl p-4 bg-white transition-all duration-300 hover:shadow-sm hover:border-indigo-200">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900">
                          Soal {q.nomor} • {q.poin} poin
                        </div>
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => openQuestionForm(q)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                      <div className="mt-1">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          normalizeQuestionType(q.question_type) === 'essay'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {getQuestionTypeLabel(q.question_type)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 mt-2">{q.soal}</p>
                      {q.image_path && (
                        <div className="mt-3">
                          <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <img
                              src={getQuizImageUrl(q.image_path)}
                              alt={`Gambar soal ${q.nomor}`}
                              className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                              onClick={() => setPreviewMediaUrl(getQuizImageUrl(q.image_path))}
                            />
                            <div className="mt-1 text-[11px] text-slate-500">
                              Ukuran: {getQuizImageSizeLabel(q.image_path)}
                            </div>
                          </div>
                        </div>
                      )}
                      {normalizeQuestionType(q.question_type) === 'essay' ? (
                        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          Soal esai dinilai manual oleh guru setelah siswa submit.
                        </div>
                      ) : (
                        (() => {
                          const optionRows = (optionsByQuestion[q.id] || [])
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
                  ))}
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
                            {row.nomor || index + 1}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {detailActiveAnswer && (() => {
                    const row = detailActiveAnswer
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
                            Soal {row.nomor} • {row.poin} poin
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
                                alt={`Gambar soal ${row.nomor}`}
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
            <h3 className="text-lg font-bold text-slate-900">Buat Quiz Baru</h3>
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
                Jadwal belum diisi di langkah ini. Setelah quiz dibuat, kamu bisa tambah soal dulu lalu atur
                tanggal mulai dan deadline di panel detail quiz.
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
                >
                  <option value="regular">Reguler</option>
                  <option value="uts">UTS</option>
                  <option value="uas">UAS</option>
                </select>
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
                  onClick={handleCreateQuiz}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                >
                  Simpan
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
                            Soal {previewQuestion.nomor || previewQuestionIndex + 1}
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
                                alt={`Preview soal ${previewQuestion.nomor}`}
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
                          {question.nomor || idx + 1}
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
                    Soal {editingQuestion?.nomor || questions.length + 1}
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
