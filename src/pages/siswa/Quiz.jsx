import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { QUIZ_MEDIA_BUCKET, supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import FilePreviewModal from '../../components/FilePreviewModal'

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const safeDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

const getLiveEndAt = (quiz) => {
  if (!quiz?.duration_minutes) return null
  const start = safeDate(quiz.live_started_at || quiz.starts_at)
  if (!start) return null
  return new Date(start.getTime() + Number(quiz.duration_minutes) * 60000)
}

const getQuizEndAt = (quiz) => (
  quiz?.is_live ? getLiveEndAt(quiz) : safeDate(quiz?.deadline_at)
)

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
  if (mode === 'uts') return 'UTS'
  if (mode === 'uas') return 'UAS'
  return 'Reguler'
}

const normalizeQuestionType = (value) => {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'essay') return 'essay'
  return 'mcq'
}

const FULLSCREEN_REQUIRED_MESSAGE = 'Quiz wajib mode fullscreen. Klik Izinkan Fullscreen di browser untuk mulai.'
const FULLSCREEN_FAILED_MESSAGE = 'Gagal masuk fullscreen. Aktifkan izin fullscreen pada browser lalu coba lagi.'
const MONTH_FILTER_ALL = ''
const MONTH_FILTER_THIS = '__this_month'
const MONTH_FILTER_LAST_12 = '__last_12_months'

const getQuizStatus = (quiz, submission, now = new Date()) => {
  const startsAt = safeDate(quiz?.starts_at)
  const deadline = safeDate(quiz?.deadline_at)

  if (submission?.status === 'finished') {
    return { label: 'Selesai', tone: 'bg-green-100 text-green-700 border border-green-200', canStart: false, kind: 'done' }
  }

  if (!startsAt) {
    return { label: 'Belum dijadwalkan', tone: 'bg-yellow-100 text-yellow-700 border border-yellow-200', canStart: false, kind: 'draft' }
  }

  if (now < startsAt) {
    return { label: 'Belum dimulai', tone: 'bg-yellow-100 text-yellow-700 border border-yellow-200', canStart: false, kind: 'scheduled' }
  }

  if (quiz?.is_live) {
    if (!quiz?.duration_minutes) {
      return { label: 'Durasi belum diatur', tone: 'bg-yellow-100 text-yellow-700 border border-yellow-200', canStart: false, kind: 'draft' }
    }
    const endAt = getLiveEndAt(quiz)
    if (endAt && now > endAt) {
      return { label: 'Waktu habis', tone: 'bg-red-100 text-red-600 border border-red-200', canStart: false, kind: 'expired' }
    }
    if (submission?.status === 'ongoing') {
      return { label: 'Sedang dikerjakan', tone: 'bg-green-100 text-green-700 border border-green-200', canStart: true, kind: 'active' }
    }
    return { label: 'Ujian berlangsung', tone: 'bg-green-100 text-green-700 border border-green-200', canStart: true, kind: 'active' }
  }

  if (!deadline) {
    return { label: 'Deadline belum diatur', tone: 'bg-yellow-100 text-yellow-700 border border-yellow-200', canStart: false, kind: 'draft' }
  }

  if (deadline && now > deadline) {
    return { label: 'Deadline lewat', tone: 'bg-red-100 text-red-600 border border-red-200', canStart: false, kind: 'expired' }
  }

  if (submission?.status === 'ongoing') {
    return { label: 'Sedang dikerjakan', tone: 'bg-green-100 text-green-700 border border-green-200', canStart: true, kind: 'active' }
  }

  return { label: 'Sedang berlangsung', tone: 'bg-green-100 text-green-700 border border-green-200', canStart: true, kind: 'active' }
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

export default function SiswaQuiz() {
  const navigate = useNavigate()
  const location = useLocation()
  const { quizId: sessionQuizIdParam = '' } = useParams()
  const isSessionPage = location.pathname.startsWith('/siswa/quiz/session/')

  const { user, profile } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  const [quizList, setQuizList] = useState([])
  const [quizLoadDone, setQuizLoadDone] = useState(false)
  const [mapelList, setMapelList] = useState([])
  const [selectedMapel, setSelectedMapel] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedQuizId, setSelectedQuizId] = useState(() => sessionQuizIdParam || '')
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [quizDetailsLoading, setQuizDetailsLoading] = useState(false)
  const [quizDetailsLoadedForId, setQuizDetailsLoadedForId] = useState('')
  const [quizDetailsError, setQuizDetailsError] = useState('')
  const [quizDetailsRetryTick, setQuizDetailsRetryTick] = useState(0)
  const [quizRealtimeTick, setQuizRealtimeTick] = useState(0)
  const [quizDetailRealtimeTick, setQuizDetailRealtimeTick] = useState(0)
  const [answers, setAnswers] = useState({})
  const [answerIds, setAnswerIds] = useState({})
  const [answerRowsByQuestion, setAnswerRowsByQuestion] = useState({})
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const [submission, setSubmission] = useState(null)
  const [showResultDetail, setShowResultDetail] = useState(false)
  const [previewMediaUrl, setPreviewMediaUrl] = useState('')
  const [isTaking, setIsTaking] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sessionPrepared, setSessionPrepared] = useState(false)
  const [sessionNeedsManualStart, setSessionNeedsManualStart] = useState(false)
  const [startCountdown, setStartCountdown] = useState({
    open: false,
    seconds: 3,
    quizId: ''
  })
  const [violationCount, setViolationCount] = useState(0)
  const [violationMessage, setViolationMessage] = useState('')
  const [violationPrompt, setViolationPrompt] = useState({
    open: false,
    message: '',
    stage: 1
  })
  const [nowTick, setNowTick] = useState(() => new Date())
  const [celebration, setCelebration] = useState({ open: false, score: null })
  const autoSubmitLockRef = useRef(false)
  const violationTriggeredRef = useRef(false)
  const violationCountRef = useRef(0)
  const violationLogRef = useRef({ key: '', at: 0 })
  const sessionInitRef = useRef('')
  const sessionBootAttemptRef = useRef('')
  const selectedQuizIdRef = useRef('')
  const trackedQuestionIdsRef = useRef(new Set())
  const essaySaveTimersRef = useRef({})
  const quizReloadTimerRef = useRef(null)
  const quizDetailReloadTimerRef = useRef(null)

  const kelasId = profile?.kelas || profile?.kelas_id || ''

  const orderedQuizList = useMemo(() => (
    sortQuizzesByPriority(quizList, nowTick)
  ), [quizList, nowTick])

  const mapelFilteredQuizzes = useMemo(() => {
    if (!selectedMapel) return orderedQuizList
    return orderedQuizList.filter((q) => q.mapel === selectedMapel)
  }, [orderedQuizList, selectedMapel])

  const monthOptions = useMemo(() => {
    const values = new Set()
    ;(mapelFilteredQuizzes || []).forEach((quiz) => {
      const monthKey = getQuizMonthKey(quiz)
      if (monthKey) values.add(monthKey)
    })
    return Array.from(values).sort((a, b) => b.localeCompare(a, 'id'))
  }, [mapelFilteredQuizzes])

  const currentMonthKey = useMemo(() => (
    getMonthKeyFromDate(nowTick)
  ), [nowTick])

  const last12MonthKeySet = useMemo(() => (
    getLastNMonthKeys(nowTick, 12)
  ), [nowTick])

  const filteredQuizzes = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) {
      return mapelFilteredQuizzes.filter((q) => getQuizMonthKey(q) === currentMonthKey)
    }
    if (selectedMonth === MONTH_FILTER_LAST_12) {
      return mapelFilteredQuizzes.filter((q) => last12MonthKeySet.has(getQuizMonthKey(q)))
    }
    if (!selectedMonth) return mapelFilteredQuizzes
    return mapelFilteredQuizzes.filter((q) => getQuizMonthKey(q) === selectedMonth)
  }, [mapelFilteredQuizzes, selectedMonth, currentMonthKey, last12MonthKeySet])

  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) return `Bulan ini (${formatQuizMonthLabel(currentMonthKey)})`
    if (selectedMonth === MONTH_FILTER_LAST_12) return '12 bulan terakhir'
    if (!selectedMonth) return 'Semua bulan'
    return formatQuizMonthLabel(selectedMonth)
  }, [selectedMonth, currentMonthKey])

  useEffect(() => {
    if (!selectedMonth) return
    if (selectedMonth === MONTH_FILTER_THIS || selectedMonth === MONTH_FILTER_LAST_12) return
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth('')
    }
  }, [selectedMonth, monthOptions])

  const selectedQuizPool = isSessionPage ? orderedQuizList : filteredQuizzes

  const selectedQuiz = useMemo(() => (
    selectedQuizPool.find((q) => q.id === selectedQuizId) || null
  ), [selectedQuizPool, selectedQuizId])

  useEffect(() => {
    selectedQuizIdRef.current = selectedQuizId || ''
  }, [selectedQuizId])

  useEffect(() => {
    if (isSessionPage) return
    if (!filteredQuizzes.length) {
      setSelectedQuizId('')
      return
    }
    if (!filteredQuizzes.find((q) => q.id === selectedQuizId)) {
      setSelectedQuizId(filteredQuizzes[0].id)
    }
  }, [isSessionPage, filteredQuizzes, selectedQuizId])

  useEffect(() => {
    if (!isSessionPage || !sessionQuizIdParam) return
    if (selectedQuizId !== sessionQuizIdParam) {
      setSelectedQuizId(sessionQuizIdParam)
    }
  }, [isSessionPage, sessionQuizIdParam, selectedQuizId])

  const activeSubmission = useMemo(() => {
    if (!selectedQuiz) return null
    if (submission?.quiz_id === selectedQuiz.id) return submission
    return selectedQuiz.submission || null
  }, [selectedQuiz, submission])
  const activeSubmissionId = activeSubmission?.id || ''

  useEffect(() => {
    trackedQuestionIdsRef.current = new Set((questions || []).map((q) => q.id).filter(Boolean))
  }, [questions])

  useEffect(() => {
    Object.values(essaySaveTimersRef.current).forEach((timerId) => clearTimeout(timerId))
    essaySaveTimersRef.current = {}
    setActiveQuestionIndex(0)
    setShowResultDetail(false)
  }, [selectedQuizId])

  useEffect(() => {
    setActiveQuestionIndex((prev) => {
      if (!questions.length) return 0
      if (prev < 0) return 0
      if (prev > questions.length - 1) return questions.length - 1
      return prev
    })
  }, [questions.length])

  const queueQuizReload = useCallback((delay = 120) => {
    if (quizReloadTimerRef.current) {
      clearTimeout(quizReloadTimerRef.current)
    }
    quizReloadTimerRef.current = setTimeout(() => {
      quizReloadTimerRef.current = null
      setQuizRealtimeTick((prev) => prev + 1)
    }, delay)
  }, [])

  const queueQuizDetailReload = useCallback((delay = 120) => {
    if (quizDetailReloadTimerRef.current) {
      clearTimeout(quizDetailReloadTimerRef.current)
    }
    quizDetailReloadTimerRef.current = setTimeout(() => {
      quizDetailReloadTimerRef.current = null
      setQuizDetailRealtimeTick((prev) => prev + 1)
    }, delay)
  }, [])

  useEffect(() => {
    return () => {
      if (quizReloadTimerRef.current) clearTimeout(quizReloadTimerRef.current)
      if (quizDetailReloadTimerRef.current) clearTimeout(quizDetailReloadTimerRef.current)
      Object.values(essaySaveTimersRef.current).forEach((timerId) => clearTimeout(timerId))
      essaySaveTimersRef.current = {}
    }
  }, [])

  const selectedStatus = useMemo(() => (
    selectedQuiz ? getQuizStatus(selectedQuiz, activeSubmission, nowTick) : null
  ), [selectedQuiz, activeSubmission, nowTick])

  const canViewSelectedResult = useMemo(() => (
    Boolean(
      selectedQuiz?.result_visible_to_students
      && (activeSubmission?.status === 'finished')
    )
  ), [selectedQuiz?.result_visible_to_students, activeSubmission?.status])

  useEffect(() => {
    if (!canViewSelectedResult && showResultDetail) {
      setShowResultDetail(false)
    }
  }, [canViewSelectedResult, showResultDetail])

  const quizStatusSummary = useMemo(() => {
    let active = 0
    let scheduled = 0
    let done = 0
    let expired = 0
    ;(filteredQuizzes || []).forEach((quiz) => {
      const kind = getQuizStatus(quiz, quiz?.submission, nowTick).kind
      if (kind === 'active') active += 1
      else if (kind === 'scheduled') scheduled += 1
      else if (kind === 'done') done += 1
      else if (kind === 'expired') expired += 1
    })
    return { active, scheduled, done, expired }
  }, [filteredQuizzes, nowTick])

  const selectedRemainingSeconds = useMemo(() => {
    if (!selectedQuiz || !selectedStatus || selectedStatus.kind !== 'active') return null
    const endAt = selectedQuiz.is_live ? getLiveEndAt(selectedQuiz) : safeDate(selectedQuiz.deadline_at)
    if (!endAt) return null
    return Math.floor((endAt.getTime() - nowTick.getTime()) / 1000)
  }, [selectedQuiz, selectedStatus, nowTick])

  const selectedStartCountdownSeconds = useMemo(() => {
    if (!selectedQuiz || !selectedStatus || selectedStatus.kind !== 'scheduled') return null
    const startsAt = safeDate(selectedQuiz.starts_at)
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

  const activeDurationText = useMemo(() => {
    if (!activeSubmission?.started_at) return '-'
    return formatDurationText(activeSubmission.started_at, activeSubmission.finished_at || nowTick)
  }, [activeSubmission?.started_at, activeSubmission?.finished_at, nowTick])

  const fullscreenActive = typeof document !== 'undefined'
    ? Boolean(document.fullscreenElement)
    : isFullscreen
  const answerInteractionLocked = (
    !isTaking
    || isSubmitting
    || violationPrompt.open
    || !fullscreenActive
  )
  const strictAnswerBlock = isTaking && (violationPrompt.open || !fullscreenActive)

  const isStartCountdownActive = startCountdown.open && startCountdown.quizId === selectedQuiz?.id

  const sparkleItems = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        left: (i * 37) % 100,
        top: (i * 53) % 100,
        delay: (i % 6) * 0.2,
        icon: i % 3 === 0 ? '✨' : i % 3 === 1 ? '🎉' : '🎊'
      })),
    []
  )

  const watermarkSeed = useMemo(
    () =>
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        top: (i * 19) % 115,
        left: (i * 31) % 115
      })),
    []
  )

  const watermarkText = useMemo(() => {
    const actor = profile?.nama || user?.email || 'Siswa'
    const kelas = profile?.kelas || profile?.kelas_id || '-'
    const stamp = nowTick.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    return `${actor} • ${kelas} • ${stamp}`
  }, [profile?.nama, profile?.kelas, profile?.kelas_id, user?.email, nowTick])

  const answeredCount = useMemo(() => (
    (questions || []).reduce((sum, question) => {
      const value = answers[question.id]
      if (normalizeQuestionType(question?.question_type) === 'essay') {
        return sum + (String(value || '').trim() ? 1 : 0)
      }
      return sum + (value ? 1 : 0)
    }, 0)
  ), [answers, questions])

  const totalQuestions = questions.length
  const activeQuestion = questions[activeQuestionIndex] || null

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

  const isQuestionAnswered = useCallback((question) => {
    if (!question?.id) return false
    const value = answers[question.id]
    if (normalizeQuestionType(question?.question_type) === 'essay') {
      return String(value || '').trim() !== ''
    }
    return Boolean(value)
  }, [answers])

  const redirectToSessionPage = useCallback((quizId, { replace = false } = {}) => {
    if (!quizId) return
    const target = `/siswa/quiz/session/${quizId}`
    navigate(target, { replace })
  }, [navigate])

  const requestQuizFullscreen = async () => {
    if (typeof document === 'undefined') return false
    if (!document.fullscreenEnabled) return false
    if (document.fullscreenElement) {
      setIsFullscreen(true)
      return true
    }
    try {
      await document.documentElement.requestFullscreen()
      setIsFullscreen(true)
      return true
    } catch {
      setIsFullscreen(false)
      return false
    }
  }

  const logViolationEvent = useCallback(async (eventType, message, meta = {}) => {
    const quizId = selectedQuiz?.id || ''
    const submissionId = activeSubmissionId
    const siswaId = user?.id || ''
    if (!quizId || !submissionId || !siswaId) return

    const normalizedType = String(eventType || 'warning').trim() || 'warning'
    const normalizedMessage = String(message || '').trim()
    const dedupeKey = `${quizId}|${submissionId}|${normalizedType}|${normalizedMessage}`
    const nowMs = Date.now()
    if (
      violationLogRef.current.key === dedupeKey
      && nowMs - Number(violationLogRef.current.at || 0) < 1200
    ) {
      return
    }
    violationLogRef.current = { key: dedupeKey, at: nowMs }

    try {
      await supabase.from('quiz_violation_logs').insert({
        id: makeId(),
        quiz_id: quizId,
        submission_id: submissionId,
        siswa_id: siswaId,
        event_type: normalizedType,
        event_message: normalizedMessage || null,
        event_meta: meta && typeof meta === 'object' ? meta : null,
        created_at: new Date().toISOString()
      })
    } catch {
      // no-op: logging tidak boleh mengganggu quiz
    }
  }, [selectedQuiz?.id, activeSubmissionId, user?.id])

  const triggerViolationPrompt = (message, eventType = 'warning', meta = {}) => {
    if (autoSubmitLockRef.current || violationTriggeredRef.current || !isTaking) return
    violationTriggeredRef.current = true

    const nextCount = violationCountRef.current + 1
    violationCountRef.current = nextCount
    setViolationCount(nextCount)
    setViolationMessage(message)
    void logViolationEvent(eventType, message, {
      warning_count: nextCount,
      ...(meta && typeof meta === 'object' ? meta : {})
    })

    setViolationPrompt({
      open: true,
      message,
      stage: 1
    })
  }

  const markSessionStarted = (bootKey) => {
    sessionInitRef.current = bootKey
    setIsTaking(true)
    setSessionNeedsManualStart(false)
    violationTriggeredRef.current = false
    setViolationCount(0)
    setViolationMessage('')
    setViolationPrompt({ open: false, message: '', stage: 1 })
  }

  const startSessionWithFullscreen = async (bootKey, showErrorToast = true) => {
    const fullscreenGranted = document.fullscreenElement
      ? true
      : await requestQuizFullscreen()

    if (!fullscreenGranted) {
      setSessionNeedsManualStart(true)
      if (showErrorToast) {
        pushToast('error', FULLSCREEN_REQUIRED_MESSAGE)
      }
      return false
    }

    const sub = await ensureSubmission()
    if (!sub) return false
    if (sub.status === 'finished') {
      navigate('/siswa/quiz', { replace: true })
      return false
    }

    markSessionStarted(bootKey)
    return true
  }

  const handleViolationCancel = async () => {
    setViolationPrompt({ open: false, message: '', stage: 1 })
    violationTriggeredRef.current = false
    const ok = await requestQuizFullscreen()
    if (!ok) {
      triggerViolationPrompt('Fullscreen wajib aktif saat quiz berlangsung.', 'fullscreen_required')
    } else {
      setViolationMessage('Peringatan diterima. Tetap fokus di quiz.')
    }
  }

  const handleViolationOk = async () => {
    if (violationPrompt.stage === 1) {
      setViolationPrompt((prev) => ({
        ...prev,
        stage: 2,
        message: 'Yakin anda keluar quiz? Jika keluar, quiz akan langsung disubmit.'
      }))
      return
    }
    void logViolationEvent('manual_submit_after_warning', 'Siswa memilih keluar quiz setelah peringatan.')
    await handleSubmitQuiz(true)
  }

  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    violationCountRef.current = violationCount
  }, [violationCount])

  useEffect(() => {
    violationLogRef.current = { key: '', at: 0 }
  }, [selectedQuiz?.id, activeSubmissionId])

  useEffect(() => {
    if (!celebration.open) return
    const timer = setTimeout(() => setCelebration({ open: false, score: null }), 6000)
    return () => clearTimeout(timer)
  }, [celebration.open])

  const loadQuizzes = async () => {
    if (!kelasId) return
    try {
      setQuizLoadDone(false)
      setLoading(true)
      const { data: quizRows, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('kelas_id', kelasId)
        .order('created_at', { ascending: false })
      if (error) throw error

      const { data: submissionRows } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('siswa_id', user.id)

      const submissionMap = new Map()
      ;(submissionRows || []).forEach((row) => {
        submissionMap.set(row.quiz_id, row)
      })

      const merged = (quizRows || []).map((q) => ({
        ...q,
        submission: submissionMap.get(q.id) || null
      }))

      const mapels = [...new Set(merged.map((q) => q.mapel).filter(Boolean))].sort()
      setMapelList(mapels)

      setQuizList(merged)
      const sortedMerged = sortQuizzesByPriority(merged, new Date())
      if (sortedMerged.length && !selectedQuizId) {
        setSelectedQuizId(sortedMerged[0].id)
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat quiz')
    } finally {
      setQuizLoadDone(true)
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.id && kelasId) loadQuizzes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, kelasId, quizRealtimeTick])

  useEffect(() => {
    if (!user?.id || !kelasId) return undefined

    const channel = supabase
      .channel(`siswa-quiz-live-${user.id}-${kelasId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quizzes',
          filter: `kelas_id=eq.${kelasId}`
        },
        (payload) => {
          const row = payload.new || payload.old
          if (!row) return
          queueQuizReload(80)
          if (row.id && row.id === selectedQuizIdRef.current) {
            queueQuizDetailReload(100)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_submissions',
          filter: `siswa_id=eq.${user.id}`
        },
        (payload) => {
          const row = payload.new || payload.old
          const quizId = row?.quiz_id
          if (!quizId) return
          queueQuizReload(90)
          if (quizId === selectedQuizIdRef.current) {
            queueQuizDetailReload(80)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, kelasId, queueQuizReload, queueQuizDetailReload])

  useEffect(() => {
    if (!selectedQuizId || !user?.id) return undefined

    const channel = supabase
      .channel(`siswa-quiz-detail-live-${user.id}-${selectedQuizId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_questions',
          filter: `quiz_id=eq.${selectedQuizId}`
        },
        () => {
          queueQuizDetailReload(70)
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
          queueQuizDetailReload(70)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_violation_logs',
          filter: `quiz_id=eq.${selectedQuizId}`
        },
        (payload) => {
          const row = payload.new || payload.old
          if (row?.siswa_id && row.siswa_id !== user.id) return
          queueQuizDetailReload(100)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedQuizId, user?.id, queueQuizDetailReload])

  useEffect(() => {
    if (!isSessionPage || !sessionQuizIdParam || !quizLoadDone) return
    const found = quizList.some((q) => q.id === sessionQuizIdParam)
    if (!found) {
      pushToast('error', 'Quiz tidak ditemukan atau tidak termasuk kelas Anda.')
      navigate('/siswa/quiz', { replace: true })
    }
  }, [isSessionPage, sessionQuizIdParam, quizLoadDone, quizList, pushToast, navigate])

  const loadQuizDetails = async () => {
    if (!selectedQuiz) {
      setQuizDetailsLoading(false)
      setQuizDetailsLoadedForId('')
      setQuizDetailsError('')
      setQuestions([])
      setOptionsByQuestion({})
      setAnswers({})
      setAnswerIds({})
      setAnswerRowsByQuestion({})
      setSubmission(null)
      return
    }

    const targetQuizId = selectedQuiz.id

    try {
      setQuizDetailsLoading(true)
      setQuizDetailsLoadedForId('')
      setQuizDetailsError('')
      setLoading(true)
      const { data: questionRows, error: questionError } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', targetQuizId)
        .order('nomor', { ascending: true })
      if (questionError) throw questionError

      const questionIds = (questionRows || []).map((q) => q.id)

      let optionRows = []
      if (questionIds.length) {
        const { data: optData, error: optError } = await supabase
          .from('quiz_options')
          .select('*')
          .in('question_id', questionIds)
        if (optError) throw optError
        optionRows = optData || []
      }

      const grouped = {}
      optionRows.forEach((opt) => {
        if (!grouped[opt.question_id]) grouped[opt.question_id] = []
        grouped[opt.question_id].push(opt)
      })
      const questionTypeById = {}
      ;(questionRows || []).forEach((question) => {
        questionTypeById[question.id] = normalizeQuestionType(question?.question_type)
      })

      let submissionRow = selectedQuiz.submission
      if (!submissionRow) {
        const { data: sub, error: subError } = await supabase
          .from('quiz_submissions')
          .select('*')
          .eq('quiz_id', targetQuizId)
          .eq('siswa_id', user.id)
          .maybeSingle()
        if (subError) throw subError
        submissionRow = sub || null
      }

      let answerMap = {}
      let answerIdMap = {}
      let answerRowMap = {}
      if (submissionRow?.id) {
        const { data: answerRows, error: answerError } = await supabase
          .from('quiz_answers')
          .select('*')
          .eq('submission_id', submissionRow.id)
        if (answerError) throw answerError

        ;(answerRows || []).forEach((row) => {
          const questionType = questionTypeById[row.question_id] || 'mcq'
          answerMap[row.question_id] = questionType === 'essay'
            ? String(row.essay_answer || '')
            : row.option_id
          answerIdMap[row.question_id] = row.id
          answerRowMap[row.question_id] = row
        })
      }

      setQuestions(questionRows || [])
      setOptionsByQuestion(grouped)
      setAnswers(answerMap)
      setAnswerIds(answerIdMap)
      setAnswerRowsByQuestion(answerRowMap)
      setSubmission(submissionRow || null)
      setQuizDetailsLoadedForId(targetQuizId)
    } catch (err) {
      setQuizDetailsLoadedForId('')
      setQuizDetailsError(err?.message || 'Gagal memuat detail quiz')
      pushToast('error', err?.message || 'Gagal memuat detail quiz')
    } finally {
      setQuizDetailsLoading(false)
      setLoading(false)
    }
  }

  const retryQuizDetails = () => {
    setQuizDetailsError('')
    setQuizDetailsRetryTick((prev) => prev + 1)
  }

  useEffect(() => {
    loadQuizDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuizId, selectedQuiz?.id, selectedQuiz?.submission?.id, user?.id, quizDetailsRetryTick, quizDetailRealtimeTick])

  useEffect(() => {
    if (!isSessionPage || !selectedQuiz?.id) return
    if (quizDetailsLoading) return
    if (quizDetailsLoadedForId === selectedQuiz.id) return
    if (quizDetailsError) return

    const timer = setTimeout(() => {
      setQuizDetailsRetryTick((prev) => prev + 1)
    }, 1200)

    return () => clearTimeout(timer)
  }, [isSessionPage, selectedQuiz?.id, quizDetailsLoading, quizDetailsLoadedForId, quizDetailsError])

  const ensureSubmission = async () => {
    if (!selectedQuiz || !user?.id) return null
    let sub = submission || selectedQuiz.submission
    if (sub && sub.quiz_id !== selectedQuiz.id) {
      sub = null
    }
    if (sub?.status === 'finished') return sub

    if (!sub) {
      const { data: existing } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('quiz_id', selectedQuiz.id)
        .eq('siswa_id', user.id)
        .maybeSingle()
      if (existing) sub = existing
    }

    if (!sub) {
      const newId = makeId()
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('quiz_submissions')
        .insert({
          id: newId,
          quiz_id: selectedQuiz.id,
          siswa_id: user.id,
          status: 'ongoing',
          started_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso
        })
      if (error) throw error
      sub = {
        id: newId,
        quiz_id: selectedQuiz.id,
        siswa_id: user.id,
        status: 'ongoing',
        started_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso
      }
    }

    setSubmission(sub)
    setQuizList((prev) => prev.map((q) => (
      q.id === selectedQuiz.id ? { ...q, submission: sub } : q
    )))
    return sub
  }

  const handleStartQuiz = async () => {
    if (!selectedQuiz) return
    if (startCountdown.open) return
    if (!selectedStatus?.canStart) {
      pushToast('error', 'Quiz belum bisa dimulai')
      return
    }
    const fullscreenGranted = document.fullscreenElement
      ? true
      : await requestQuizFullscreen()
    if (!fullscreenGranted) {
      pushToast('error', FULLSCREEN_REQUIRED_MESSAGE)
      return
    }
    setStartCountdown({
      open: true,
      seconds: 3,
      quizId: selectedQuiz.id
    })
  }

  const saveAnswer = async (questionId, value, questionType = 'mcq', options = {}) => {
    if (!selectedQuiz) return
    if (answerInteractionLocked) return
    const sub = await ensureSubmission()
    if (!sub?.id) return

    const mode = normalizeQuestionType(questionType)
    const answerId = answerIds[questionId] || makeId()
    const nowIso = new Date().toISOString()
    const optionId = mode === 'mcq' ? (value || null) : null
    const essayAnswer = mode === 'essay'
      ? (() => {
          const text = String(value || '')
          return text.trim() ? text : null
        })()
      : null
    const payload = {
      id: answerId,
      submission_id: sub.id,
      question_id: questionId,
      option_id: optionId,
      essay_answer: essayAnswer,
      created_at: nowIso,
      updated_at: nowIso
    }

    const { error } = await supabase
      .from('quiz_answers')
      .upsert(payload, { onConflict: 'submission_id,question_id' })

    if (error) {
      if (!options?.silent) {
        pushToast('error', error?.message || 'Gagal menyimpan jawaban')
      }
      return
    }

    setAnswers((prev) => ({ ...prev, [questionId]: mode === 'essay' ? String(value || '') : optionId }))
    setAnswerIds((prev) => ({ ...prev, [questionId]: answerId }))
  }

  const handleEssayChange = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    if (essaySaveTimersRef.current[questionId]) {
      clearTimeout(essaySaveTimersRef.current[questionId])
    }
    essaySaveTimersRef.current[questionId] = setTimeout(() => {
      delete essaySaveTimersRef.current[questionId]
      void saveAnswer(questionId, value, 'essay', { silent: true })
    }, 550)
  }

  const handleEssayBlur = (questionId, value) => {
    if (essaySaveTimersRef.current[questionId]) {
      clearTimeout(essaySaveTimersRef.current[questionId])
      delete essaySaveTimersRef.current[questionId]
    }
    void saveAnswer(questionId, value, 'essay')
  }

  const buildSubmitAnswersPayload = () => (
    (questions || []).map((question) => {
      const questionType = normalizeQuestionType(question?.question_type)
      const answerValue = answers[question.id]
      if (questionType === 'essay') {
        const essayText = String(answerValue || '')
        return {
          question_id: question.id,
          essay_answer: essayText.trim() ? essayText : null,
          option_id: null
        }
      }
      return {
        question_id: question.id,
        option_id: answerValue || null
      }
    })
  )

  const handleSubmitQuiz = async (auto = false) => {
    const sub = submission?.quiz_id === selectedQuiz?.id ? submission : activeSubmission
    if (!selectedQuiz || !sub?.id || isSubmitting || autoSubmitLockRef.current) return

    if (!auto) {
      const ok = window.confirm('Apakah yakin Anda menyelesaikan quiz sekarang? Jawaban tidak bisa diubah lagi.')
      if (!ok) return
    }

    try {
      autoSubmitLockRef.current = true
      setIsSubmitting(true)
      Object.values(essaySaveTimersRef.current).forEach((timerId) => clearTimeout(timerId))
      essaySaveTimersRef.current = {}
      const { data, error } = await supabase.quiz.submit({
        quiz_id: selectedQuiz.id,
        submission_id: sub.id,
        answers: buildSubmitAnswersPayload()
      })
      if (error) throw error

      const score = data?.score ?? null
      const canShowScoreNow = Boolean(selectedQuiz?.result_visible_to_students)
      const updated = {
        ...(sub || {}),
        status: 'finished',
        score,
        finished_at: new Date().toISOString()
      }

      setSubmission(updated)
      setQuizList((prev) => prev.map((q) => (
        q.id === selectedQuiz.id ? { ...q, submission: updated } : q
      )))
      setIsTaking(false)
      setViolationMessage('')
      setViolationPrompt({ open: false, message: '', stage: 1 })
      setCelebration({ open: true, score: canShowScoreNow ? score : null })
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen()
        } catch {}
      }
      pushToast('success', canShowScoreNow ? 'Quiz selesai. Nilai sudah tersedia.' : 'Quiz selesai. Hasil menunggu publikasi dari guru.')
      if (isSessionPage) {
        navigate('/siswa/quiz', { replace: true })
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyelesaikan quiz')
    } finally {
      setIsSubmitting(false)
      autoSubmitLockRef.current = false
    }
  }

  useEffect(() => {
    if (isTaking) return
    violationTriggeredRef.current = false
    setViolationPrompt({ open: false, message: '', stage: 1 })
  }, [isTaking])

  useEffect(() => {
    if (!isTaking || !selectedQuiz) {
      setRemainingSeconds(null)
      return
    }

    const endAt = selectedQuiz.is_live
      ? getLiveEndAt(selectedQuiz)
      : safeDate(selectedQuiz.deadline_at)
    if (!endAt) {
      setRemainingSeconds(null)
      return
    }

    const tick = () => {
      const diff = Math.floor((endAt.getTime() - Date.now()) / 1000)
      setRemainingSeconds(diff)
      if (diff <= 0) {
        handleSubmitQuiz(true)
      }
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTaking, selectedQuiz?.id, selectedQuiz?.is_live, selectedQuiz?.live_started_at, selectedQuiz?.duration_minutes, selectedQuiz?.deadline_at, submission?.id, activeSubmission?.id])

  useEffect(() => {
    if (!isTaking) return

    const markScreenshotViolation = async () => {
      setViolationMessage('Percobaan screenshot terdeteksi saat quiz berjalan.')
      triggerViolationPrompt('Percobaan screenshot terdeteksi saat quiz berjalan.', 'screenshot_attempt')
      if (!navigator?.clipboard?.writeText) return
      try {
        await navigator.clipboard.writeText('')
      } catch {}
    }

    const lockKeyboardShortcuts = async () => {
      // Chrome/Edge fullscreen-only API: helps block more keys like Esc.
      if (!document.fullscreenElement) return
      if (!navigator?.keyboard?.lock) return
      try {
        await navigator.keyboard.lock(['Escape', 'Tab', 'Meta', 'Alt'])
      } catch {}
    }

    const unlockKeyboardShortcuts = () => {
      if (!navigator?.keyboard?.unlock) return
      try {
        navigator.keyboard.unlock()
      } catch {}
    }

    const handleVisibility = () => {
      if (document.hidden) {
        triggerViolationPrompt('Anda keluar dari halaman quiz.', 'page_hidden')
      }
    }

    const handleBlur = () => {
      if (document.hidden) return
      triggerViolationPrompt('Anda berpindah aplikasi/tab saat quiz berjalan.', 'window_blur')
    }

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      if (active) {
        lockKeyboardShortcuts()
      } else {
        triggerViolationPrompt('Fullscreen ditutup saat quiz berjalan.', 'fullscreen_exit')
      }
    }

    const handleKeydownCapture = (event) => {
      const key = String(event.key || '').toLowerCase()
      if (key === 'printscreen') {
        event.preventDefault()
        event.stopPropagation()
        markScreenshotViolation()
        return
      }

      const blockedStrictKeys = new Set(['tab', 'escape', 'control', ' ', 'spacebar'])
      if (blockedStrictKeys.has(key)) {
        event.preventDefault()
        event.stopPropagation()
        const message = `Tombol "${event.key}" dinonaktifkan saat quiz berlangsung.`
        setViolationMessage(message)
        void logViolationEvent('blocked_key', message, { key: event.key })
        return
      }

      const withCmd = event.ctrlKey || event.metaKey
      const blockedComboKeys = ['t', 'n', 'w', 'l', 'r', 'p', 'j', 'k']
      const isBlockedCombo = withCmd && blockedComboKeys.includes(key)
      const isBlockedSingle = key === 'f11' || key === 'f12'
      if (isBlockedCombo || isBlockedSingle) {
        event.preventDefault()
        event.stopPropagation()
        triggerViolationPrompt('Percobaan membuka fitur browser terdeteksi.', 'blocked_shortcut')
      }
    }

    const handleKeyupCapture = (event) => {
      const key = String(event.key || '').toLowerCase()
      if (key === 'printscreen') {
        event.preventDefault()
        event.stopPropagation()
        markScreenshotViolation()
      }
    }

    const blockClipboardAndContext = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const message = 'Copy/cut/klik kanan dinonaktifkan saat quiz berlangsung.'
      setViolationMessage(message)
      void logViolationEvent('clipboard_or_context', message, { action: event.type })
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const focusGuard = setInterval(() => {
      if (!document.hasFocus()) {
        triggerViolationPrompt('Fokus browser hilang saat quiz berjalan.', 'focus_lost')
      }
    }, 800)

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('keydown', handleKeydownCapture, true)
    document.addEventListener('keyup', handleKeyupCapture, true)
    document.addEventListener('copy', blockClipboardAndContext, true)
    document.addEventListener('cut', blockClipboardAndContext, true)
    document.addEventListener('contextmenu', blockClipboardAndContext, true)
    document.addEventListener('dragstart', blockClipboardAndContext, true)
    window.addEventListener('beforeunload', handleBeforeUnload)
    lockKeyboardShortcuts()

    return () => {
      clearInterval(focusGuard)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('keydown', handleKeydownCapture, true)
      document.removeEventListener('keyup', handleKeyupCapture, true)
      document.removeEventListener('copy', blockClipboardAndContext, true)
      document.removeEventListener('cut', blockClipboardAndContext, true)
      document.removeEventListener('contextmenu', blockClipboardAndContext, true)
      document.removeEventListener('dragstart', blockClipboardAndContext, true)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unlockKeyboardShortcuts()
    }
  }, [isTaking, selectedQuiz?.id, submission?.id, activeSubmission?.id, logViolationEvent])

  useEffect(() => {
    if (isTaking) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isTaking])

  useEffect(() => {
    if (!isSessionPage) {
      sessionInitRef.current = ''
      sessionBootAttemptRef.current = ''
      setSessionPrepared(false)
      setSessionNeedsManualStart(false)
      return
    }
    if (!sessionQuizIdParam || !selectedQuiz || selectedQuiz.id !== sessionQuizIdParam) return
    if (activeSubmission?.status === 'finished') return
    if (!selectedStatus?.canStart) {
      pushToast('error', 'Quiz belum aktif atau sudah berakhir.')
      navigate('/siswa/quiz', { replace: true })
      return
    }
    if (quizDetailsLoading || quizDetailsLoadedForId !== selectedQuiz.id) return
    if (!questions.length) {
      pushToast('error', 'Quiz belum memiliki soal.')
      navigate('/siswa/quiz', { replace: true })
      return
    }

    const bootKey = `${selectedQuiz.id}:${activeSubmission?.id || 'new'}:${activeSubmission?.status || 'none'}`
    if (sessionInitRef.current === bootKey && isTaking) {
      setSessionPrepared(true)
      return
    }

    if (sessionBootAttemptRef.current === bootKey) return

    let canceled = false
    const bootSession = async () => {
      try {
        setLoading(true)
        if (!canceled) {
          setSessionPrepared(true)
          setSessionNeedsManualStart(false)
        }
        sessionBootAttemptRef.current = bootKey
        const shouldAutoStart = typeof document !== 'undefined' && Boolean(document.fullscreenElement)
        if (!shouldAutoStart) {
          if (!canceled) setSessionNeedsManualStart(true)
          return
        }
        const started = await startSessionWithFullscreen(bootKey, false)
        if (!started && !canceled) {
          setSessionNeedsManualStart(true)
        }
      } catch (err) {
        if (!canceled) {
          setSessionNeedsManualStart(true)
          pushToast('error', err?.message || 'Gagal memulai sesi quiz')
        }
      } finally {
        if (!canceled) setLoading(false)
      }
    }

    bootSession()
    return () => {
      canceled = true
    }
  }, [
    isSessionPage,
    sessionQuizIdParam,
    selectedQuiz?.id,
    activeSubmission?.id,
    activeSubmission?.status,
    selectedStatus?.canStart,
    quizDetailsLoading,
    quizDetailsLoadedForId,
    questions.length,
    isTaking
  ])

  useEffect(() => {
    if (isSessionPage) return
    if (!isTaking || !selectedQuiz?.id) return
    redirectToSessionPage(selectedQuiz.id, { replace: true })
  }, [isSessionPage, isTaking, selectedQuiz?.id])

  useEffect(() => {
    if (!startCountdown.open) return
    if (!startCountdown.quizId) {
      setStartCountdown({ open: false, seconds: 3, quizId: '' })
      return
    }
    if (startCountdown.seconds > 0) {
      const timer = setTimeout(() => {
        setStartCountdown((prev) => {
          if (!prev.open) return prev
          return {
            ...prev,
            seconds: Math.max(0, prev.seconds - 1)
          }
        })
      }, 1000)
      return () => clearTimeout(timer)
    }

    const goTimer = setTimeout(() => {
      const stillFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenElement)
      const targetQuizId = startCountdown.quizId
      setStartCountdown({ open: false, seconds: 3, quizId: '' })
      if (!stillFullscreen) {
        pushToast('error', FULLSCREEN_REQUIRED_MESSAGE)
        return
      }
      redirectToSessionPage(targetQuizId)
    }, 700)
    return () => clearTimeout(goTimer)
  }, [startCountdown.open, startCountdown.seconds, startCountdown.quizId, pushToast, redirectToSessionPage])

  const handleForceFullscreen = async () => {
    const ok = await requestQuizFullscreen()
    if (!ok) {
      pushToast('error', FULLSCREEN_FAILED_MESSAGE)
    }
  }

  const handleManualStartSession = async () => {
    if (!selectedQuiz) return
    const bootKey = `${selectedQuiz.id}:${activeSubmission?.id || 'new'}:${activeSubmission?.status || 'none'}`
    try {
      setLoading(true)
      await startSessionWithFullscreen(bootKey, true)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memulai quiz')
    } finally {
      setLoading(false)
    }
  }

  const handleCloseCelebration = () => {
    setCelebration({ open: false, score: null })
  }

  const warningMessage = violationPrompt.open
    ? violationPrompt.message
    : (violationMessage || (
      answerInteractionLocked
        ? 'Pilihan jawaban dikunci. Aktifkan fullscreen lalu klik Batal pada peringatan untuk lanjut.'
        : ''
    ))

  const sessionWarningPanel = isTaking && warningMessage && (
    <div className="rounded-2xl bg-red-50 border border-red-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold text-red-700">Peringatan Ujian</div>
          <p className="text-sm text-slate-700 mt-2">{warningMessage}</p>
          {violationPrompt.open && (
            <p className="text-sm text-slate-600 mt-2">
              {violationPrompt.stage === 1
                ? 'Klik Oke jika ingin melanjutkan proses keluar quiz, atau Batal untuk kembali mengerjakan.'
                : 'Konfirmasi terakhir. Jika klik Oke, quiz akan disubmit dan dianggap selesai.'}
            </p>
          )}
        </div>
        <div className="text-xs font-semibold text-red-700 whitespace-nowrap">
          Peringatan: {violationCount}
        </div>
      </div>
      {violationPrompt.open && (
        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleViolationCancel}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleViolationOk}
            className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
          >
            Oke
          </button>
        </div>
      )}
    </div>
  )

  const celebrationOverlay = celebration.open && (
    <div className="fixed inset-0 z-[1300] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center px-4">
      <div className="relative w-full max-w-2xl rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 sm:p-8 shadow-2xl overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          {sparkleItems.map((item) => (
            <span
              key={item.id}
              className="absolute text-2xl animate-bounce"
              style={{
                left: `${item.left}%`,
                top: `${item.top}%`,
                animationDelay: `${item.delay}s`,
                animationDuration: '1.8s'
              }}
            >
              {item.icon}
            </span>
          ))}
        </div>

        <div className="relative text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wider">
            Selamat
          </div>
          <h3 className="mt-4 text-3xl sm:text-4xl font-black text-slate-900">
            Quiz Selesai
          </h3>
          <p className="mt-2 text-slate-600">
            Jawaban Anda sudah dikirim dan dinilai.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white border border-emerald-200 shadow-sm">
            <span className="text-sm text-slate-600">Nilai Anda</span>
            <span className="text-2xl font-black text-emerald-700">{celebration.score ?? '-'}</span>
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={handleCloseCelebration}
              className="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              Tutup Notifikasi
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  if (isSessionPage) {
    return (
      <div className="fixed inset-0 z-[999] bg-slate-100 overflow-hidden">
        {!selectedQuiz ? (
          <div className="h-full w-full flex items-center justify-center px-6">
            <div className="text-center text-slate-600 text-sm sm:text-base font-medium">
              Menyiapkan sesi quiz...
            </div>
          </div>
        ) : (
          <div className="h-full w-full flex flex-col">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
              <div className="w-full px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-xl font-bold text-slate-900">{selectedQuiz.nama}</div>
                  <div className="text-xs text-slate-500">
                    Terjawab {answeredCount} / {totalQuestions}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {selectedQuiz.mapel} | Mode {getModeLabel(selectedQuiz)}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {(remainingSeconds != null || selectedRemainingSeconds != null) && (
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-800 shadow-sm">
                      <div className="text-[11px] font-semibold uppercase tracking-wide">Timer Quiz</div>
                      <div className="text-lg font-black leading-none mt-0.5">
                        {formatRemaining(remainingSeconds ?? selectedRemainingSeconds)}
                      </div>
                    </div>
                  )}
                  {!isFullscreen && isTaking && (
                    <button
                      type="button"
                      onClick={handleForceFullscreen}
                      className="text-xs px-3 py-1 rounded-full bg-slate-900 text-white"
                    >
                      Masuk Fullscreen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSubmitQuiz(false)}
                    className="px-4 py-2 rounded-2xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                    disabled={!isTaking || isSubmitting}
                  >
                    Selesaikan Quiz
                  </button>
                </div>
              </div>
              <div className="px-4 sm:px-6 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                Mode ketat aktif: quiz wajib fullscreen, tidak boleh pindah tab/aplikasi, dan screenshot dibatasi.
              </div>
            </div>

            <div className="relative flex-1 overflow-y-auto p-4 sm:p-6 select-none">
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {watermarkSeed.map((wm) => (
                  <div
                    key={wm.id}
                    className="absolute text-[11px] text-slate-300/55 font-semibold rotate-[-20deg] whitespace-nowrap"
                    style={{ top: `${wm.top}%`, left: `${wm.left}%` }}
                  >
                    {watermarkText}
                  </div>
                ))}
              </div>

              <div className="relative z-10 space-y-5">
                {celebrationOverlay}
                {sessionWarningPanel}

                {!isTaking && (
                  <div className="px-4 py-4 bg-gradient-to-r from-sky-50 to-cyan-50 border border-sky-200 rounded-2xl text-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-sky-900">Sesi siap dimulai</div>
                        <div className="text-xs text-sky-700 mt-1">
                          {sessionNeedsManualStart
                            ? 'Izin fullscreen ditolak browser. Klik tombol mulai agar sistem mencoba lagi.'
                            : 'Klik mulai untuk masuk fullscreen, lalu kerjakan quiz tanpa pindah tab.'}
                        </div>
                      </div>
                      {sessionPrepared && (
                        <button
                          type="button"
                          onClick={handleManualStartSession}
                          className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
                        >
                          Mulai Sesi Aman
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {(quizDetailsLoading || quizDetailsLoadedForId !== selectedQuiz.id) && (
                  <div className="text-sm text-slate-500">Menyiapkan soal quiz...</div>
                )}

                {!!quizDetailsError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span>Gagal memuat soal quiz: {quizDetailsError}</span>
                    <button
                      type="button"
                      onClick={retryQuizDetails}
                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                    >
                      Coba Lagi
                    </button>
                  </div>
                )}

                {!quizDetailsLoading && quizDetailsLoadedForId !== selectedQuiz.id && !quizDetailsError && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span>Detail quiz belum siap. Halaman akan memuat ulang data otomatis.</span>
                      <button
                        type="button"
                        onClick={retryQuizDetails}
                        className="px-2.5 py-1 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold"
                      >
                        Muat Ulang Soal
                      </button>
                    </div>
                  </div>
                )}

                {quizDetailsLoadedForId === selectedQuiz.id && !quizDetailsLoading && (
                  <div className="relative">
                    {strictAnswerBlock && (
                      <div className="absolute inset-0 z-20 rounded-2xl bg-slate-200/40 backdrop-blur-[1px] cursor-not-allowed" />
                    )}

                    <div className={`grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 ${strictAnswerBlock ? 'pointer-events-none' : ''}`}>
                      <div className="space-y-5">
                        {!!activeQuestion && (
                          <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-slate-900">
                                Soal {activeQuestion.nomor || activeQuestionIndex + 1}
                                <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full border align-middle ${
                                  normalizeQuestionType(activeQuestion.question_type) === 'essay'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}>
                                  {normalizeQuestionType(activeQuestion.question_type) === 'essay' ? 'Esai' : 'PG'}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500">{activeQuestion.poin} poin</div>
                            </div>
                            <div className="text-sm text-slate-700 mb-4">{activeQuestion.soal}</div>
                            {activeQuestion.image_path && (
                              <div className="mb-4">
                                <div className="inline-flex max-w-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                                  <img
                                    src={getQuizImageUrl(activeQuestion.image_path)}
                                    alt={`Gambar soal ${activeQuestion.nomor || activeQuestionIndex + 1}`}
                                    className="block max-h-[22rem] w-auto max-w-full object-contain rounded-xl cursor-zoom-in"
                                    onClick={() => setPreviewMediaUrl(getQuizImageUrl(activeQuestion.image_path))}
                                  />
                                  <div className="mt-1 text-[11px] text-slate-500">
                                    Klik gambar untuk perbesar.
                                  </div>
                                </div>
                              </div>
                            )}
                            {normalizeQuestionType(activeQuestion.question_type) === 'essay' ? (
                              <div>
                                <textarea
                                  rows="6"
                                  value={String(answers[activeQuestion.id] || '')}
                                  onChange={(e) => handleEssayChange(activeQuestion.id, e.target.value)}
                                  onBlur={(e) => handleEssayBlur(activeQuestion.id, e.target.value)}
                                  disabled={answerInteractionLocked}
                                  placeholder="Tulis jawaban esai Anda di sini..."
                                  className={`w-full border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                    answerInteractionLocked
                                      ? 'border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed'
                                      : 'border-slate-300 bg-white'
                                  }`}
                                />
                                <div className="text-[11px] text-slate-500 mt-2">
                                  Jawaban esai dinilai manual oleh guru.
                                </div>
                              </div>
                            ) : (
                              (() => {
                                const mcqOptions = (optionsByQuestion[activeQuestion.id] || [])
                                  .slice()
                                  .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
                                return (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                                    {mcqOptions.map((opt) => {
                                      const selected = answers[activeQuestion.id] === opt.id
                                      const disabled = answerInteractionLocked
                                      return (
                                        <div key={opt.id} className="space-y-2">
                                          <button
                                            type="button"
                                            onClick={() => saveAnswer(activeQuestion.id, opt.id, 'mcq')}
                                            disabled={disabled}
                                            className={`w-full min-h-[52px] text-left px-4 py-3 rounded-2xl border transition ${
                                              selected
                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                : disabled
                                                  ? 'border-slate-200 bg-slate-50'
                                                  : 'border-slate-200 hover:bg-slate-50'
                                            } ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
                                          >
                                            <span className="font-semibold mr-2">{opt.label}.</span>
                                            <span>{opt.text}</span>
                                          </button>
                                          {!!opt.image_path && (
                                            <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                                              <img
                                                src={getQuizImageUrl(opt.image_path)}
                                                alt={`Gambar opsi ${opt.label}`}
                                                className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                                onClick={() => setPreviewMediaUrl(getQuizImageUrl(opt.image_path))}
                                              />
                                              <div className="mt-1 text-[11px] text-slate-500">Klik gambar untuk perbesar.</div>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              })()
                            )}
                          </div>
                        )}

                        {!!activeQuestion && (
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveQuestionIndex((prev) => Math.max(0, prev - 1))}
                              disabled={activeQuestionIndex <= 0 || strictAnswerBlock || isSubmitting}
                              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                            >
                              Soal Sebelumnya
                            </button>
                            <div className="text-xs text-slate-500">
                              {activeQuestionIndex + 1} / {questions.length}
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                              disabled={activeQuestionIndex >= questions.length - 1 || strictAnswerBlock || isSubmitting}
                              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                            >
                              Soal Berikutnya
                            </button>
                          </div>
                        )}
                      </div>

                      {!!questions.length && (
                        <div className="lg:sticky lg:top-4 h-fit">
                          <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <div className="text-sm font-semibold text-slate-800">Navigasi Soal</div>
                              <div className="text-[11px] text-slate-500">Hijau = sudah dijawab</div>
                            </div>
                            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-4 gap-2">
                              {questions.map((q, index) => {
                                const isActive = index === activeQuestionIndex
                                const isAnswered = isQuestionAnswered(q)
                                const numberLabel = q?.nomor || index + 1
                                return (
                                  <button
                                    key={q.id}
                                    type="button"
                                    onClick={() => setActiveQuestionIndex(index)}
                                    disabled={strictAnswerBlock || isSubmitting}
                                    className={`h-9 rounded-lg text-sm font-semibold border transition ${
                                      isActive
                                        ? 'border-indigo-500 bg-indigo-600 text-white'
                                        : isAnswered
                                          ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                    } ${
                                      strictAnswerBlock || isSubmitting
                                        ? 'opacity-70 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    {numberLabel}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {quizDetailsLoadedForId === selectedQuiz.id && !quizDetailsLoading && !questions.length && (
                  <div className="text-sm text-slate-500">Quiz belum memiliki soal.</div>
                )}
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50/40 to-blue-50/50 py-6 px-4 sm:px-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-cyan-500 to-blue-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">Quiz Siswa</h1>
                <p className="text-sm text-slate-500">Kerjakan quiz sesuai jadwal yang ditentukan guru.</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Siswa</div>
                <div className="font-semibold text-slate-800">{profile?.nama || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">Kelas: {kelasId || '-'}</div>
              </div>
              <select
                className="border border-slate-200 rounded-2xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
              >
                <option value="">Semua mapel</option>
                {mapelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="border border-slate-200 rounded-2xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              <button
                type="button"
                onClick={loadQuizzes}
                className="px-4 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition-colors"
              >
                Muat Ulang
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Daftar Quiz</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{filteredQuizzes.length} quiz ditampilkan</p>
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
            <div className="p-5 space-y-3 min-h-[30rem] max-h-[calc(100vh-130px)] overflow-y-auto">
              <div className="flex flex-wrap gap-2">
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  Berlangsung: {quizStatusSummary.active}
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                  Akan datang: {quizStatusSummary.scheduled}
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  Selesai: {quizStatusSummary.done}
                </span>
              </div>
              {filteredQuizzes.length === 0 && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4">
                  Belum ada quiz untuk kelas ini.
                </div>
              )}
              {filteredQuizzes.map((q, index) => {
                const status = getQuizStatus(q, q.submission, nowTick)
                const mutationMeta = getQuizMutationMeta(q)
                const canViewResult = Boolean(q.result_visible_to_students)
                const countdownMeta = getQuizCountdownMeta(q, status, nowTick)
                const durationText = q.submission?.started_at
                  ? formatDurationText(q.submission.started_at, q.submission.finished_at || nowTick)
                  : null
                const isNewestCard = index === 0
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
                          : status.kind === 'active' || status.kind === 'done'
                            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/90 to-green-50/40 hover:border-emerald-300 hover:shadow-sm'
                            : 'border-amber-200 bg-gradient-to-r from-amber-50/90 to-yellow-50/40 hover:border-amber-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{q.nama}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 border border-slate-200 text-slate-700">
                            {q.mapel}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 border border-slate-200 text-slate-700">
                            Mode {getModeLabel(q)}
                          </span>
                          {isNewestCard && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 border border-indigo-200 text-indigo-700 font-semibold">
                              Terbaru dibuat
                            </span>
                          )}
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${mutationMeta.tone}`}>
                            {mutationMeta.label}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="text-[11px] rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-sky-800">
                        <span className="font-semibold">Mulai</span>
                        <div className="mt-0.5">{q.starts_at ? formatDateTime(q.starts_at) : '-'}</div>
                      </div>
                      <div className="text-[11px] rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-800">
                        <span className="font-semibold">Deadline</span>
                        <div className="mt-0.5">{q.deadline_at ? formatDateTime(q.deadline_at) : '-'}</div>
                      </div>
                    </div>
                    {countdownMeta && (
                      <div className={`mt-2 rounded-xl border px-3 py-2 ${countdownMeta.tone}`}>
                        <div className="text-[11px] font-semibold uppercase tracking-wide">{countdownMeta.label}</div>
                        <div className="text-base font-black leading-none mt-1">
                          {formatRemaining(countdownMeta.seconds)}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {canViewResult && q.submission?.score != null && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                          Nilai: {q.submission.score}
                        </span>
                      )}
                      {durationText && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                          Durasi: {durationText}
                        </span>
                      )}
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        canViewResult
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        Hasil: {canViewResult ? 'Bisa dilihat' : 'Disembunyikan'}
                      </span>
                      {canViewResult && q.submission?.status === 'finished' && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedQuizId(q.id)
                            setShowResultDetail(true)
                          }}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-200 font-semibold cursor-pointer"
                        >
                          Detail Hasil
                        </span>
                      )}
                    </div>
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
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-teal-600 rounded-full"></div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{selectedQuiz.nama}</h3>
                      <div className="text-sm text-slate-500 mt-1 flex flex-wrap items-center gap-1.5">
                        <span>{selectedQuiz.mapel}</span>
                        <span>•</span>
                        <span>Mode {getModeLabel(selectedQuiz)}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${getQuizMutationMeta(selectedQuiz).tone}`}>
                          {getQuizMutationMeta(selectedQuiz).label}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          selectedQuiz?.result_visible_to_students
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          Hasil: {selectedQuiz?.result_visible_to_students ? 'Bisa dilihat' : 'Disembunyikan'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {selectedStatus && (
                      <span className={`text-xs px-3 py-1 rounded-full ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    )}
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

                <div className="p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                      <div className="text-xs text-sky-700 font-semibold">Tanggal Mulai</div>
                      <div className="text-sm text-slate-800 mt-1 font-semibold">
                        {selectedQuiz.starts_at ? formatDateTime(selectedQuiz.starts_at) : '-'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                      <div className="text-xs text-rose-700 font-semibold">Deadline</div>
                      <div className="text-sm text-slate-800 mt-1 font-semibold">
                        {selectedQuiz.deadline_at ? formatDateTime(selectedQuiz.deadline_at) : 'Tidak ada'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="border border-blue-200 rounded-2xl p-3 bg-gradient-to-r from-blue-50 to-indigo-50">
                      <div className="text-xs text-slate-500">Jumlah Soal</div>
                      <div className="text-xl font-bold text-slate-900">{totalQuestions}</div>
                    </div>
                    <div className="border border-purple-200 rounded-2xl p-3 bg-gradient-to-r from-purple-50 to-indigo-50">
                      <div className="text-xs text-slate-500">Terjawab</div>
                      <div className="text-xl font-bold text-slate-900">{answeredCount}</div>
                    </div>
                    <div className="border border-emerald-200 rounded-2xl p-3 bg-gradient-to-r from-emerald-50 to-green-50">
                      <div className="text-xs text-slate-500">Nilai</div>
                      <div className="text-xl font-bold text-slate-900">
                        {canViewSelectedResult ? (activeSubmission?.score ?? '-') : '-'}
                      </div>
                    </div>
                    <div className="border border-amber-200 rounded-2xl p-3 bg-gradient-to-r from-amber-50 to-yellow-50">
                      <div className="text-xs text-slate-500">Durasi Anda</div>
                      <div className="text-xl font-bold text-slate-900">{activeDurationText}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4">
                    <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white to-cyan-50/50 px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">Ruang Persiapan Quiz</div>
                      <div className="text-xs text-slate-600 mt-1">
                        Pastikan koneksi stabil, baterai cukup, dan siapkan jawaban sebelum klik mulai.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          Fullscreen wajib aktif
                        </span>
                        <span className="text-[11px] px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 border border-sky-200">
                          Auto simpan jawaban esai
                        </span>
                        <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          Hindari pindah tab/aplikasi
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row xl:flex-col gap-2 xl:min-w-[220px]">
                      {selectedStatus?.canStart && (
                        <button
                          type="button"
                          onClick={handleStartQuiz}
                          disabled={isStartCountdownActive}
                          className={`px-5 py-2.5 rounded-2xl text-white font-semibold transition-colors shadow-sm ${
                            isStartCountdownActive
                              ? 'bg-indigo-300 cursor-not-allowed'
                              : 'bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700'
                          }`}
                        >
                          {isStartCountdownActive
                            ? `Mulai dalam ${Math.max(startCountdown.seconds, 0)}`
                            : activeSubmission?.status === 'ongoing'
                              ? 'Lanjutkan Quiz'
                              : 'Mulai Quiz'}
                        </button>
                      )}
                      {!selectedStatus?.canStart && (
                        <button
                          type="button"
                          disabled
                          className="px-5 py-2.5 rounded-2xl bg-slate-100 text-slate-400 font-semibold cursor-not-allowed"
                        >
                          Quiz belum tersedia
                        </button>
                      )}
                      {activeSubmission?.score != null && (
                        <div className="text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-2xl px-3 py-2 text-center">
                          {canViewSelectedResult ? 'Nilai sudah keluar.' : 'Nilai sudah keluar, tapi masih disembunyikan guru.'}
                        </div>
                      )}
                      {canViewSelectedResult && (
                        <button
                          type="button"
                          onClick={() => setShowResultDetail(true)}
                          className="px-5 py-2.5 rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100"
                        >
                          Detail Hasil
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {showResultDetail && (
          <div className="fixed inset-0 z-[1100] bg-black/55 backdrop-blur-[1px] flex items-center justify-center p-4">
            <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl flex flex-col">
              <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-900">Detail Hasil Quiz</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {selectedQuiz?.nama || '-'} • {selectedQuiz?.mapel || '-'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowResultDetail(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Tutup
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4">
                {!canViewSelectedResult && (
                  <div className="text-sm text-slate-600 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    Hasil quiz masih disembunyikan oleh guru.
                  </div>
                )}

                {canViewSelectedResult && quizDetailsLoadedForId !== selectedQuiz?.id && (
                  <div className="text-sm text-slate-600 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    Memuat detail hasil...
                  </div>
                )}

                {canViewSelectedResult && quizDetailsLoadedForId === selectedQuiz?.id && !questions.length && (
                  <div className="text-sm text-slate-600 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    Detail soal belum tersedia.
                  </div>
                )}

                {canViewSelectedResult && quizDetailsLoadedForId === selectedQuiz?.id && (questions || []).map((question, idx) => {
                  const questionType = normalizeQuestionType(question?.question_type)
                  const optionRows = (optionsByQuestion[question.id] || [])
                    .slice()
                    .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
                  const selectedOptionId = answers[question.id] || null
                  const selectedOption = optionRows.find((row) => row?.id === selectedOptionId) || null
                  const correctOption = optionRows.find((row) => Boolean(row?.is_correct)) || null
                  const answerRow = answerRowsByQuestion[question.id] || null
                  const essayAnswer = String(answers[question.id] || '').trim()
                  const essayScore = answerRow?.essay_score

                  return (
                    <div key={question.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          Soal {question.nomor || idx + 1}
                          <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full border align-middle ${
                            questionType === 'essay'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            {questionType === 'essay' ? 'Esai' : 'PG'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">{question.poin} poin</div>
                      </div>
                      <div className="text-sm text-slate-700 mt-2">{question.soal}</div>

                      {!!question.image_path && (
                        <div className="mt-3">
                          <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <img
                              src={getQuizImageUrl(question.image_path)}
                              alt={`Gambar soal ${question.nomor || idx + 1}`}
                              className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                              onClick={() => setPreviewMediaUrl(getQuizImageUrl(question.image_path))}
                            />
                          </div>
                        </div>
                      )}

                      {questionType === 'essay' ? (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs font-semibold text-slate-600">Jawaban Anda</div>
                          <div className="text-sm text-slate-700 whitespace-pre-wrap border border-slate-200 rounded-xl p-3 bg-slate-50 min-h-16">
                            {essayAnswer || 'Belum ada jawaban esai.'}
                          </div>
                          <div className="text-xs">
                            Nilai esai:{' '}
                            <span className={`font-semibold ${
                              essayScore == null ? 'text-slate-500' : 'text-emerald-700'
                            }`}>
                              {essayScore == null ? 'Belum dinilai guru' : `${essayScore}`}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {optionRows.map((opt) => {
                              const isSelected = selectedOptionId === opt.id
                              const isCorrect = Boolean(opt.is_correct)
                              return (
                                <div key={opt.id} className="space-y-2">
                                  <div
                                    className={`text-sm px-3 py-2 rounded-xl border min-h-[46px] ${
                                      isCorrect
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
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
                                        className="block max-h-52 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                        onClick={() => setPreviewMediaUrl(getQuizImageUrl(opt.image_path))}
                                      />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          <div className="text-xs text-slate-600">
                            Jawaban Anda: {selectedOption ? `${selectedOption.label}. ${selectedOption.text}` : '-'}
                            {' • '}
                            Kunci: {correctOption ? `${correctOption.label}. ${correctOption.text}` : '-'}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
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

        {celebrationOverlay}

        {startCountdown.open && (
          <div className="fixed inset-0 z-[1200] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="text-center select-none">
              <div className="text-xs sm:text-sm uppercase tracking-[0.3em] font-bold text-slate-200/90">
                Persiapan Quiz
              </div>
              <div className={`mt-4 text-8xl sm:text-9xl font-black leading-none text-white ${
                startCountdown.seconds > 0 ? 'animate-pulse' : 'animate-bounce'
              }`}>
                {startCountdown.seconds > 0 ? startCountdown.seconds : 'Mulai!'}
              </div>
              <p className="mt-5 text-sm text-slate-200/90 max-w-md">
                Tetap fokus. Setelah hitung mundur selesai, sistem akan langsung membuka sesi quiz aman.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
