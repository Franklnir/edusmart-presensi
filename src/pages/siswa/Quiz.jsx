import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Expand,
  Flag,
  ListChecks,
  Lock,
  Send,
  ShieldCheck
} from 'lucide-react'
import { QUIZ_MEDIA_BUCKET, supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime, parseDateTime } from '../../lib/time'
import FilePreviewModal from '../../components/FilePreviewModal'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { filterSchedulesForSemester } from '../../utils/schedulePeriodScope'

const safeDate = (value) => {
  return parseDateTime(value)
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

const normalizeQuestionNumbering = (questionRows = []) => (
  (questionRows || []).map((question, index) => ({
    ...question,
    nomor: index + 1
  }))
)

const getStableQuizDeviceId = () => {
  if (typeof window === 'undefined') return ''
  const key = 'edusmart_device_id'
  let deviceId = ''
  try {
    deviceId = window.localStorage.getItem(key) || ''
  } catch { }
  if (!deviceId) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      deviceId = crypto.randomUUID()
    } else {
      deviceId = `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
    try {
      window.localStorage.setItem(key, deviceId)
    } catch { }
  }
  return deviceId
}

const normalizeAnswerOrder = (value) => {
  if (!value) return null
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.map((id) => String(id || '')).filter(Boolean)
    : []
  const options = {}
  Object.entries(parsed.options || {}).forEach(([questionId, optionIds]) => {
    if (!Array.isArray(optionIds)) return
    options[String(questionId)] = optionIds.map((id) => String(id || '')).filter(Boolean)
  })
  return { questions, options }
}

const getOptionDisplayLabel = (index) => (
  index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
)

const applyQuizOrder = (questionRows = [], groupedOptions = {}, rawOrder = null) => {
  const order = normalizeAnswerOrder(rawOrder)
  if (!order) {
    return {
      questions: questionRows || [],
      optionsByQuestion: groupedOptions || {}
    }
  }

  const questionMap = new Map((questionRows || []).map((question) => [String(question.id), question]))
  const seenQuestions = new Set()
  const orderedQuestions = []
  ;(order.questions || []).forEach((questionId) => {
    const question = questionMap.get(String(questionId))
    if (!question) return
    seenQuestions.add(String(questionId))
    orderedQuestions.push(question)
  })
  ;(questionRows || []).forEach((question) => {
    const questionId = String(question.id)
    if (seenQuestions.has(questionId)) return
    orderedQuestions.push(question)
  })

  const orderedGrouped = {}
  Object.entries(groupedOptions || {}).forEach(([questionId, options]) => {
    const optionMap = new Map((options || []).map((option) => [String(option.id), option]))
    const seenOptions = new Set()
    const orderedOptions = []
    ;(order.options?.[questionId] || []).forEach((optionId) => {
      const option = optionMap.get(String(optionId))
      if (!option) return
      seenOptions.add(String(optionId))
      orderedOptions.push(option)
    })
    ;(options || []).forEach((option) => {
      const optionId = String(option.id)
      if (seenOptions.has(optionId)) return
      orderedOptions.push(option)
    })
    orderedGrouped[questionId] = orderedOptions.map((option, index) => ({
      ...option,
      label: getOptionDisplayLabel(index)
    }))
  })

  return {
    questions: orderedQuestions,
    optionsByQuestion: orderedGrouped
  }
}

const FULLSCREEN_REQUIRED_MESSAGE = 'Quiz mode ketat wajib fullscreen. Klik tombol Izinkan Fullscreen & Mulai, lalu pilih Izinkan pada browser.'
const FULLSCREEN_FAILED_MESSAGE = 'Browser menolak fullscreen. Klik ulang tombol mulai dan pilih Izinkan pada popup browser.'
const MONTH_FILTER_ALL = ''
const MONTH_FILTER_THIS = '__this_month'

const normalizeAccessDevice = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'web') return 'web'
  if (raw === 'mobile' || raw === 'mobile_app' || raw === 'app') return 'mobile'
  return 'both'
}

const getAccessDeviceLabel = (value) => {
  const mode = normalizeAccessDevice(value)
  if (mode === 'web') return 'Web saja'
  if (mode === 'mobile') return 'Mobile saja'
  return 'Web & Mobile'
}

const getWebAccessBlockMessage = (quiz) => (
  normalizeAccessDevice(quiz?.access_device) === 'mobile'
    ? 'Quiz ini hanya dapat dikerjakan melalui aplikasi mobile. Buka aplikasi EduSmart Mobile untuk mengerjakan.'
    : ''
)

const TEXT_EDITABLE_INPUT_TYPES = new Set([
  '',
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week'
])

const getTextEditableElement = (target) => {
  if (!target) return null
  const element = target.nodeType === 1 ? target : target.parentElement
  const editable = element?.closest?.('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"]')
  if (!editable) return null
  if (editable.disabled || editable.readOnly) return null

  const tagName = String(editable.tagName || '').toLowerCase()
  if (tagName === 'textarea') return editable
  if (tagName === 'input') {
    const type = String(editable.getAttribute('type') || editable.type || '').toLowerCase()
    return TEXT_EDITABLE_INPUT_TYPES.has(type) ? editable : null
  }
  return editable.isContentEditable ? editable : null
}

const getActiveTextEditableElement = () => (
  typeof document === 'undefined' ? null : getTextEditableElement(document.activeElement)
)

const getQuizStatus = (quiz, submission, now = new Date()) => {
  const startsAt = safeDate(quiz?.starts_at)
  const deadline = safeDate(quiz?.deadline_at)
  const closedAt = safeDate(quiz?.closed_at)

  if (submission?.status === 'finished') {
    return { label: 'Selesai', tone: 'bg-green-100 text-green-700 border border-green-200', canStart: false, kind: 'done' }
  }

  if (closedAt) {
    return { label: 'Ditutup guru', tone: 'bg-red-100 text-red-600 border border-red-200', canStart: false, kind: 'expired' }
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
  const {
	    activeAcademicPeriod,
	    period,
	    dateFilterPeriod,
	    periodFilter,
    academicYearOptions,
    semesterOptions,
    setAcademicYear,
    setSemester,
    resetToActivePeriod,
    applyPeriodFilters
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.siswa.quiz.periodFilter'
  })

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
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [textInputFocused, setTextInputFocused] = useState(false)
  const [textInputFullscreenGraceUntil, setTextInputFullscreenGraceUntil] = useState(0)
  const [sessionPrepared, setSessionPrepared] = useState(false)
  const [sessionNeedsManualStart, setSessionNeedsManualStart] = useState(false)
  const [sessionQuizFallback, setSessionQuizFallback] = useState(null)
  const [fullscreenGuideOpen, setFullscreenGuideOpen] = useState(false)
  const [deviceLockNotice, setDeviceLockNotice] = useState({ open: false, message: '', retryAfter: null })
  const [resumeQuizNotice, setResumeQuizNotice] = useState({ open: false, quiz: null })
  const [dismissedResumeQuizId, setDismissedResumeQuizId] = useState('')
  const [privacyShield, setPrivacyShield] = useState({
    open: false,
    message: '',
    reason: ''
  })
  const [startCountdown, setStartCountdown] = useState({
    open: false,
    seconds: 3,
    quizId: ''
  })
  const [accessCodeInput, setAccessCodeInput] = useState('')
  const [violationCount, setViolationCount] = useState(0)
  const [violationMessage, setViolationMessage] = useState('')
  const [violationPrompt, setViolationPrompt] = useState({
    open: false,
    message: '',
    stage: 1
  })
  const [nowTick, setNowTick] = useState(() => new Date())
  const [celebration, setCelebration] = useState({
    open: false,
    score: null,
    title: '',
    message: '',
    tone: 'emerald'
  })
  const autoSubmitLockRef = useRef(false)
  const violationTriggeredRef = useRef(false)
  const violationCountRef = useRef(0)
  const violationLogRef = useRef({ key: '', at: 0 })
  const strictSecurityLockRef = useRef({ key: '', at: 0 })
  const strictSecurityIncidentRef = useRef({ active: false, id: '', at: 0, reason: '' })
  const sessionInitRef = useRef('')
  const sessionBootAttemptRef = useRef('')
  const selectedQuizIdRef = useRef('')
  const trackedQuestionIdsRef = useRef(new Set())
  const essaySaveTimersRef = useRef({})
  const essayDraftMetaRef = useRef({})
  const quizDetailRequestSeqRef = useRef(0)
  const quizReloadTimerRef = useRef(null)
  const quizDetailReloadTimerRef = useRef(null)

  const kelasId = profile?.kelas || profile?.kelas_id || ''
  const buildQuizClientMeta = useCallback((extra = {}) => ({
    client: 'web',
    device: 'web',
    client_device: 'web',
    device_id: getStableQuizDeviceId(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight }
      : null,
    ...extra
  }), [])
  const handleQuizRequestError = useCallback((error) => {
    if (error?.code !== 'quiz_device_session_locked') return false
    setIsTaking(false)
    setSessionNeedsManualStart(false)
    setSubmitConfirmOpen(false)
    const message = error.message || 'Quiz ini sedang aktif di perangkat lain. Lanjutkan dari perangkat pertama atau minta guru mereset attempt.'
    setDeviceLockNotice({
      open: true,
      message,
      retryAfter: error?.retry_after_seconds ?? null
    })
    pushToast('error', message)
    if (isSessionPage) {
      navigate('/siswa/quiz', { replace: true })
    }
    return true
  }, [isSessionPage, navigate, pushToast])

  const orderedQuizList = useMemo(() => (
    sortQuizzesByPriority(quizList, nowTick)
  ), [quizList, nowTick])

  const mapelFilteredQuizzes = useMemo(() => {
    if (!selectedMapel) return orderedQuizList
    return orderedQuizList.filter((q) => q.mapel === selectedMapel)
  }, [orderedQuizList, selectedMapel])

	  const monthOptions = useMemo(() => (
	    (dateFilterPeriod.months || []).map((month) => month.value)
	  ), [dateFilterPeriod.months])

  const currentMonthKey = useMemo(() => (
    getMonthKeyFromDate(nowTick)
  ), [nowTick])

  const filteredQuizzes = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) {
      return mapelFilteredQuizzes.filter((q) => getQuizMonthKey(q) === currentMonthKey)
    }
    if (!selectedMonth) return mapelFilteredQuizzes
    return mapelFilteredQuizzes.filter((q) => getQuizMonthKey(q) === selectedMonth)
  }, [mapelFilteredQuizzes, selectedMonth, currentMonthKey])

  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === MONTH_FILTER_THIS) return `Bulan ini (${formatQuizMonthLabel(currentMonthKey)})`
    if (!selectedMonth) return 'Semua bulan periode'
    return formatQuizMonthLabel(selectedMonth)
  }, [selectedMonth, currentMonthKey])

  useEffect(() => {
    if (!selectedMonth) return
    if (selectedMonth === MONTH_FILTER_THIS) return
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth('')
    }
  }, [selectedMonth, monthOptions])

  const selectedQuizPool = isSessionPage ? orderedQuizList : filteredQuizzes

  const selectedQuiz = useMemo(() => {
    const listedQuiz = selectedQuizPool.find((q) => q.id === selectedQuizId)
    if (listedQuiz) return listedQuiz
    if (isSessionPage && sessionQuizFallback?.id === selectedQuizId) {
      return sessionQuizFallback
    }
    return null
  }, [selectedQuizPool, selectedQuizId, isSessionPage, sessionQuizFallback])

  useEffect(() => {
    if (!isSessionPage) {
      setSessionQuizFallback(null)
      return
    }
    if (sessionQuizFallback && sessionQuizFallback.id !== selectedQuizId) {
      setSessionQuizFallback(null)
    }
  }, [isSessionPage, selectedQuizId, sessionQuizFallback])

  useEffect(() => {
    selectedQuizIdRef.current = selectedQuizId || ''
  }, [selectedQuizId])

  useEffect(() => {
    setAccessCodeInput('')
  }, [selectedQuiz?.id])

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
    essayDraftMetaRef.current = {}
    quizDetailRequestSeqRef.current += 1
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
      essayDraftMetaRef.current = {}
      quizDetailRequestSeqRef.current += 1
    }
  }, [])

  const selectedStatus = useMemo(() => (
    selectedQuiz ? getQuizStatus(selectedQuiz, activeSubmission, nowTick) : null
  ), [selectedQuiz, activeSubmission, nowTick])

  const resumableQuiz = useMemo(() => {
    const candidates = (quizList || []).filter((quiz) => {
      const sub = quiz?.submission
      if (!quiz?.id || sub?.status !== 'ongoing') return false
      return getQuizStatus(quiz, sub, nowTick).kind === 'active'
    })
    if (!candidates.length) return null
    return sortQuizzesByPriority(candidates, nowTick)[0] || null
  }, [quizList, nowTick])

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
  const isStrictSecurity = selectedQuiz?.security_mode === 'strict'
  const strictTextInputGrace = isStrictSecurity && textInputFocused && nowTick.getTime() < Number(textInputFullscreenGraceUntil || 0)
  const strictSecurityLocked = isTaking && isStrictSecurity && (
    privacyShield.open
    || violationPrompt.open
    || (!fullscreenActive && !strictTextInputGrace)
  )
  const answerInteractionLocked = (
    !isTaking
    || isSubmitting
    || strictSecurityLocked
  )
  const strictAnswerBlock = strictSecurityLocked

  const isStartCountdownActive = startCountdown.open && startCountdown.quizId === selectedQuiz?.id
  const selectedWebAccessBlockMessage = getWebAccessBlockMessage(selectedQuiz)
  const selectedWebAccessBlocked = Boolean(selectedWebAccessBlockMessage)
  const selectedCanStartInWeb = Boolean(selectedStatus?.canStart && !selectedWebAccessBlocked)

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
  const answeredPercent = totalQuestions > 0
    ? Math.round((answeredCount / totalQuestions) * 100)
    : 0
  const unansweredCount = Math.max(0, totalQuestions - answeredCount)
  const activeQuestionType = normalizeQuestionType(activeQuestion?.question_type)
  const sessionTimerSeconds = remainingSeconds ?? selectedRemainingSeconds
  const sessionTimerTone = sessionTimerSeconds != null && sessionTimerSeconds <= 60
    ? 'border-red-200 bg-red-50 text-red-700'
    : sessionTimerSeconds != null && sessionTimerSeconds <= 300
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-white text-slate-900'
  const sessionModeLabel = isStrictSecurity ? 'Mode ketat' : 'Mode standar'
  const sessionAccessLabel = getAccessDeviceLabel(selectedQuiz?.access_device)

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

  const getQuizItemImagePath = useCallback((item) => (
    normalizeQuizMediaPath(item?.image_path || item?.media_url || '')
  ), [normalizeQuizMediaPath])
  const activeQuestionImagePath = getQuizItemImagePath(activeQuestion)

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
      await supabase.quiz.logViolation({
        quiz_id: quizId,
        submission_id: submissionId,
        event_type: normalizedType,
        event_message: normalizedMessage || null,
        event_meta: meta && typeof meta === 'object' ? meta : null,
        client_meta: buildQuizClientMeta()
      })
    } catch {
      // no-op: logging tidak boleh mengganggu quiz
    }
  }, [selectedQuiz?.id, activeSubmissionId, user?.id, buildQuizClientMeta])

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

  const releaseStrictIncident = useCallback(() => {
    strictSecurityLockRef.current = { key: '', at: 0 }
    strictSecurityIncidentRef.current = { active: false, id: '', at: 0, reason: '' }
  }, [])

  const lockStrictSession = useCallback((message, eventType = 'warning', meta = {}) => {
    if (!isTaking || !isStrictSecurity || autoSubmitLockRef.current) return

    const normalizedType = String(eventType || 'warning').trim() || 'warning'
    const nowMs = Date.now()
    const key = `${normalizedType}|${String(message || '').trim()}`
    if (strictSecurityIncidentRef.current.active) {
      return
    }
    if (
      strictSecurityLockRef.current.key === key
      && nowMs - Number(strictSecurityLockRef.current.at || 0) < 4000
    ) {
      return
    }

    const nextCount = violationCountRef.current + 1
    const incidentId = `${selectedQuiz?.id || 'quiz'}:${activeSubmissionId || 'submission'}:${nowMs}:${nextCount}`
    strictSecurityLockRef.current = { key, at: nowMs }
    strictSecurityIncidentRef.current = {
      active: true,
      id: incidentId,
      at: nowMs,
      reason: normalizedType
    }
    violationCountRef.current = nextCount
    setViolationCount(nextCount)
    setViolationMessage(message)
    setPrivacyShield({
      open: true,
      message,
      reason: normalizedType
    })
    void logViolationEvent(normalizedType, message, {
      warning_count: nextCount,
      incident_id: incidentId,
      incident_reason: normalizedType,
      shield: true,
      ...(meta && typeof meta === 'object' ? meta : {})
    })
  }, [isTaking, isStrictSecurity, selectedQuiz?.id, activeSubmissionId, logViolationEvent])

  const markSessionStarted = (bootKey) => {
    sessionInitRef.current = bootKey
    setIsTaking(true)
    setSessionNeedsManualStart(false)
    releaseStrictIncident()
    setPrivacyShield({ open: false, message: '', reason: '' })
    setTextInputFullscreenGraceUntil(0)
    violationTriggeredRef.current = false
    violationCountRef.current = 0
    setViolationCount(0)
    setViolationMessage('')
    setViolationPrompt({ open: false, message: '', stage: 1 })
    setSubmitConfirmOpen(false)
  }

  const startSessionWithFullscreen = async (bootKey, showErrorToast = true) => {
    if (!isStrictSecurity) {
      const sub = await ensureSubmission()
      if (!sub) return false
      if (sub.status === 'finished') {
        navigate('/siswa/quiz', { replace: true })
        return false
      }

      markSessionStarted(bootKey)
      return true
    }

    const fullscreenGranted = document.fullscreenElement
      ? true
      : await requestQuizFullscreen()

    if (!fullscreenGranted) {
      setSessionNeedsManualStart(true)
      setFullscreenGuideOpen(true)
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
      lockStrictSession(
        'Fullscreen wajib aktif saat quiz berlangsung.',
        'fullscreen_required'
      )
    } else {
      releaseStrictIncident()
      setPrivacyShield({ open: false, message: '', reason: '' })
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
    if (!isTaking || !user?.id) return undefined
    const deviceId = getStableQuizDeviceId()
    if (!deviceId) return undefined

    let stopped = false
    const pingQuizPresence = async () => {
      try {
        await supabase.presence.ping({ deviceId, activity: true })
      } catch {}
    }

    void pingQuizPresence()
    const interval = setInterval(() => {
      if (!stopped) void pingQuizPresence()
    }, 10000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [isTaking, user?.id])

  useEffect(() => {
    if (!celebration.open) return
    const timer = setTimeout(() => setCelebration({ open: false, score: null }), 6000)
    return () => clearTimeout(timer)
  }, [celebration.open])

  const loadScheduleMapels = useCallback(async () => {
    if (!kelasId) return []

    try {
	      let query = supabase
	        .from('jadwal')
	        .select('mapel,periode_berlaku')
	        .eq('kelas_id', kelasId)
	        .order('mapel', { ascending: true })
      query = applyPeriodFilters(query)

      const { data, error } = await query
      if (error) throw error

	      return [...new Set(
	        filterSchedulesForSemester(data || [], periodFilter.semester)
	          .map((row) => String(row?.mapel || '').trim())
	          .filter(Boolean)
	      )].sort((a, b) => a.localeCompare(b, 'id'))
    } catch (err) {
      console.warn('Gagal memuat mapel jadwal quiz siswa:', err)
      return []
    }
	  }, [applyPeriodFilters, kelasId, periodFilter.semester])

  const rememberEssayDraft = (questionId, value) => {
    const key = String(questionId || '')
    if (!key) return 0
    const current = essayDraftMetaRef.current[key] || {}
    const revision = Number(current.revision || 0) + 1
    essayDraftMetaRef.current[key] = {
      value: String(value ?? ''),
      revision,
      updatedAt: Date.now(),
      savedAt: Number(current.savedAt || 0)
    }
    return revision
  }

  const markEssayDraftSaved = (questionId, value, revision) => {
    const key = String(questionId || '')
    const current = essayDraftMetaRef.current[key]
    if (!current) return
    if (Number(current.revision || 0) !== Number(revision || 0)) return
    if (String(current.value ?? '') !== String(value ?? '')) return
    essayDraftMetaRef.current[key] = {
      ...current,
      savedAt: Date.now()
    }
  }

  const shouldKeepEssayDraft = (questionId, serverValue) => {
    const key = String(questionId || '')
    const current = essayDraftMetaRef.current[key]
    if (!current) return false

    const draftValue = String(current.value ?? '')
    const normalizedServerValue = String(serverValue ?? '')
    const hasPendingTimer = Boolean(essaySaveTimersRef.current[questionId] || essaySaveTimersRef.current[key])
    const recentlyEdited = Date.now() - Number(current.updatedAt || 0) < 15000

    return hasPendingTimer || recentlyEdited || draftValue !== normalizedServerValue
  }

  const mergeServerAnswersWithEssayDrafts = (serverAnswers = {}, questionTypeById = {}) => {
    const next = { ...(serverAnswers || {}) }
    Object.entries(questionTypeById || {}).forEach(([questionId, questionType]) => {
      if (normalizeQuestionType(questionType) !== 'essay') return
      if (!shouldKeepEssayDraft(questionId, serverAnswers?.[questionId])) return
      next[questionId] = String(essayDraftMetaRef.current[String(questionId)]?.value ?? '')
    })
    return next
  }

  const loadQuizzes = async () => {
    if (!kelasId) return
    try {
      setQuizLoadDone(false)
      setLoading(true)
      const [dashboardResult, scheduleMapels] = await Promise.all([
        supabase.quiz.dashboard({
          page: 1,
          per_page: 100,
          kelas: kelasId,
          tahun_ajaran: period.tahunAjaran,
          semester: period.semester
        }),
        loadScheduleMapels()
      ])
      const { data, error } = dashboardResult || {}
      if (error?.code === 'REQUEST_ABORTED') return
      if (error) throw error

      const merged = data?.rows || []

      const quizMapels = merged
        .map((q) => String(q?.mapel || '').trim())
        .filter(Boolean)
      const mapels = [...new Set([...scheduleMapels, ...quizMapels])].sort((a, b) => a.localeCompare(b, 'id'))
      startTransition(() => {
        setMapelList(mapels)
        setQuizList(merged)
        const sortedMerged = sortQuizzesByPriority(merged, new Date())
        if (sortedMerged.length && !selectedQuizId) {
          setSelectedQuizId(sortedMerged[0].id)
        }
      })
    } catch (err) {
      if (err?.code === 'REQUEST_ABORTED') return
      const scheduleMapels = await loadScheduleMapels()
      startTransition(() => {
        setMapelList(scheduleMapels)
        setQuizList([])
      })
      pushToast('error', err?.message || 'Gagal memuat quiz')
    } finally {
      setQuizLoadDone(true)
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.id && kelasId) loadQuizzes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, kelasId, quizRealtimeTick, period.tahunAjaran, period.semester])

  useEffect(() => {
    if (isSessionPage) return undefined
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
  }, [isSessionPage, user?.id, kelasId, queueQuizReload, queueQuizDetailReload])

  useEffect(() => {
    if (isSessionPage) return undefined
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
  }, [isSessionPage, selectedQuizId, user?.id, queueQuizDetailReload])

  const loadQuizDetails = async () => {
    const targetQuizId = selectedQuiz?.id || (isSessionPage ? sessionQuizIdParam : '')
    if (!targetQuizId) {
      quizDetailRequestSeqRef.current += 1
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

    const requestSeq = ++quizDetailRequestSeqRef.current
    try {
      setQuizDetailsLoading(true)
      setQuizDetailsLoadedForId('')
      setQuizDetailsError('')
      setLoading(true)
      const { data, error } = await supabase.quiz.detail(targetQuizId, {
        tahun_ajaran: period.tahunAjaran,
        semester: period.semester,
        client: 'web',
        client_device_id: getStableQuizDeviceId()
      })
      if (error?.code === 'REQUEST_ABORTED') return
      if (error) throw error
      if (requestSeq !== quizDetailRequestSeqRef.current) return

      const questionRows = data?.questions || []
      const grouped = data?.options_by_question || {}
      const questionTypeById = {}
      ;(questionRows || []).forEach((question) => {
        questionTypeById[question.id] = normalizeQuestionType(question?.question_type)
      })

      const submissionRow = data?.submission || selectedQuiz?.submission || null
      const quizPayload = data?.quiz
        ? { ...data.quiz, submission: submissionRow || data.quiz.submission || null }
        : null

      let answerMap = {}
      let answerIdMap = {}
      let answerRowMap = {}
      if (submissionRow?.id) {
        ;(data?.answers || []).forEach((row) => {
          const questionType = questionTypeById[row.question_id] || 'mcq'
          answerMap[row.question_id] = questionType === 'essay'
            ? String(row.essay_answer || '')
            : row.option_id
          answerIdMap[row.question_id] = row.id
          answerRowMap[row.question_id] = row
        })
      }

      const orderedDetail = applyQuizOrder(questionRows || [], grouped, submissionRow?.answer_order)
      const numberedQuestions = normalizeQuestionNumbering(orderedDetail.questions)
      startTransition(() => {
        if (requestSeq !== quizDetailRequestSeqRef.current) return
        if (quizPayload) {
          setSessionQuizFallback(quizPayload)
          setQuizList((prev) => {
            const exists = prev.some((q) => q.id === quizPayload.id)
            if (exists) {
              return prev.map((q) => (q.id === quizPayload.id ? { ...q, ...quizPayload } : q))
            }
            return [quizPayload, ...prev]
          })
        }
        setQuestions(numberedQuestions)
        setOptionsByQuestion(orderedDetail.optionsByQuestion)
        setAnswers(() => mergeServerAnswersWithEssayDrafts(answerMap, questionTypeById))
        setAnswerIds(answerIdMap)
        setAnswerRowsByQuestion(answerRowMap)
        setSubmission(submissionRow || null)
        setQuizDetailsLoadedForId(targetQuizId)
      })
    } catch (err) {
      if (err?.code === 'REQUEST_ABORTED') return
      if (requestSeq !== quizDetailRequestSeqRef.current) return
      if (handleQuizRequestError(err)) return
      setQuizDetailsLoadedForId('')
      setQuizDetailsError(err?.message || 'Gagal memuat detail quiz')
      pushToast('error', err?.message || 'Gagal memuat detail quiz')
    } finally {
      if (requestSeq === quizDetailRequestSeqRef.current) {
        setQuizDetailsLoading(false)
        setLoading(false)
      }
    }
  }

  const retryQuizDetails = () => {
    setQuizDetailsError('')
    setQuizDetailsRetryTick((prev) => prev + 1)
  }

  useEffect(() => {
    loadQuizDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuizId, selectedQuiz?.id, selectedQuiz?.submission?.id, user?.id, quizDetailsRetryTick, quizDetailRealtimeTick, period.tahunAjaran, period.semester])

  useEffect(() => {
    if (isSessionPage || isTaking || !quizLoadDone || !resumableQuiz?.id) return
    if (resumeQuizNotice.open) return
    if (dismissedResumeQuizId === resumableQuiz.id) return
    setResumeQuizNotice({ open: true, quiz: resumableQuiz })
  }, [isSessionPage, isTaking, quizLoadDone, resumableQuiz, dismissedResumeQuizId, resumeQuizNotice.open])

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

    const { data, error } = await supabase.quiz.start({
      quiz_id: selectedQuiz.id,
      access_code: accessCodeInput.trim() || undefined,
      client_meta: buildQuizClientMeta({
        fullscreen: Boolean(document.fullscreenElement)
      })
    })
    if (error) throw error

    sub = data?.submission || sub
    if (Array.isArray(data?.questions)) {
      setQuestions(normalizeQuestionNumbering(data.questions))
      setOptionsByQuestion(data.options_by_question || {})
      setQuizDetailsLoadedForId(selectedQuiz.id)
    }

    if (!sub) return null

    setSubmission(sub)
    setQuizList((prev) => prev.map((q) => (
      q.id === selectedQuiz.id ? { ...q, submission: sub } : q
    )))
    return sub
  }

  const handleStartQuiz = async () => {
    if (!selectedQuiz) return
    if (startCountdown.open) return
    if (selectedWebAccessBlocked) {
      pushToast('error', selectedWebAccessBlockMessage)
      return
    }
    if (!selectedStatus?.canStart) {
      pushToast('error', 'Quiz belum bisa dimulai')
      return
    }
    if (isStrictSecurity) {
      const fullscreenGranted = document.fullscreenElement
        ? true
        : await requestQuizFullscreen()
      if (!fullscreenGranted) {
        setSessionNeedsManualStart(true)
        setFullscreenGuideOpen(true)
        pushToast('error', FULLSCREEN_REQUIRED_MESSAGE)
        return
      }
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
    let sub = null
    try {
      sub = await ensureSubmission()
    } catch (err) {
      if (!handleQuizRequestError(err) && !options?.silent) {
        pushToast('error', err?.message || 'Gagal menyiapkan sesi quiz')
      }
      return
    }
    if (!sub?.id) return

    const mode = normalizeQuestionType(questionType)
    const answerId = answerIds[questionId] || ''
    const optionId = mode === 'mcq' ? (value || null) : null
    const essayAnswer = mode === 'essay'
      ? (() => {
          const text = String(value || '')
          return text.trim() ? text : null
        })()
      : null
    const essayRevision = mode === 'essay'
      ? Number(options?.revision || essayDraftMetaRef.current[String(questionId || '')]?.revision || 0)
      : 0
    const { data, error } = await supabase.quiz.saveAnswer({
      id: answerId,
      quiz_id: selectedQuiz.id,
      submission_id: sub.id,
      question_id: questionId,
      option_id: optionId,
      essay_answer: essayAnswer,
      client_meta: buildQuizClientMeta({
        fullscreen: Boolean(document.fullscreenElement)
      })
    })

    if (error) {
      if (!handleQuizRequestError(error) && !options?.silent) {
        pushToast('error', error?.message || 'Gagal menyimpan jawaban')
      }
      return
    }

    let shouldApplyAnswerPayload = true
    if (mode === 'essay') {
      const latestDraft = essayDraftMetaRef.current[String(questionId || '')]
      const savedText = String(value || '')
      const responseStillCurrent = !latestDraft
        || Number(latestDraft.revision || 0) <= essayRevision
        || String(latestDraft.value ?? '') === savedText

      shouldApplyAnswerPayload = responseStillCurrent
      if (responseStillCurrent) {
        setAnswers((prev) => ({ ...prev, [questionId]: savedText }))
      }
      markEssayDraftSaved(questionId, savedText, essayRevision)
    } else {
      setAnswers((prev) => ({ ...prev, [questionId]: optionId }))
    }
    const savedAnswerId = data?.answer_id || answerId
    if (savedAnswerId) {
      setAnswerIds((prev) => ({ ...prev, [questionId]: savedAnswerId }))
      setAnswerRowsByQuestion((prev) => ({
        ...prev,
        [questionId]: (() => {
          const previousRow = prev[questionId] || {}
          return {
            ...previousRow,
            id: savedAnswerId,
            submission_id: sub.id,
            question_id: questionId,
            option_id: optionId,
            essay_answer: mode === 'essay' && !shouldApplyAnswerPayload ? previousRow.essay_answer : essayAnswer,
            saved_at: data?.saved_at || new Date().toISOString()
          }
        })()
      }))
    }
  }

  const handleEssayChange = (questionId, value) => {
    const revision = rememberEssayDraft(questionId, value)
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    if (essaySaveTimersRef.current[questionId]) {
      clearTimeout(essaySaveTimersRef.current[questionId])
    }
    essaySaveTimersRef.current[questionId] = setTimeout(() => {
      delete essaySaveTimersRef.current[questionId]
      void saveAnswer(questionId, value, 'essay', { silent: true, revision })
    }, 550)
  }

  const handleEssayBlur = (questionId, value) => {
    if (essaySaveTimersRef.current[questionId]) {
      clearTimeout(essaySaveTimersRef.current[questionId])
      delete essaySaveTimersRef.current[questionId]
    }
    const currentDraft = essayDraftMetaRef.current[String(questionId || '')]
    const revision = currentDraft && String(currentDraft.value ?? '') === String(value ?? '')
      ? Number(currentDraft.revision || 0)
      : rememberEssayDraft(questionId, value)
    void saveAnswer(questionId, value, 'essay', { revision })
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

  const handleSubmitQuiz = async (auto = false, options = {}) => {
    const sub = submission?.quiz_id === selectedQuiz?.id ? submission : activeSubmission
    if (!selectedQuiz || !sub?.id || isSubmitting || autoSubmitLockRef.current) return

    const confirmed = Boolean(options?.confirmed)
    const timeExpired = options?.reason === 'time_expired'
    if (!auto && !confirmed) {
      setSubmitConfirmOpen(true)
      return
    }

    try {
      autoSubmitLockRef.current = true
      setIsSubmitting(true)
      setSubmitConfirmOpen(false)
      Object.values(essaySaveTimersRef.current).forEach((timerId) => clearTimeout(timerId))
      essaySaveTimersRef.current = {}
      const { data, error } = await supabase.quiz.submit({
        quiz_id: selectedQuiz.id,
        submission_id: sub.id,
        answers: buildSubmitAnswersPayload(),
        client_meta: buildQuizClientMeta({
          fullscreen: Boolean(document.fullscreenElement)
        })
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
      setPrivacyShield({ open: false, message: '', reason: '' })
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen()
        } catch {}
      }
      setCelebration({
        open: true,
        score: canShowScoreNow ? score : null,
        title: timeExpired ? 'Waktu Quiz Habis' : 'Quiz Selesai',
        message: timeExpired
          ? 'Waktu pengerjaan sudah habis. Jawaban terakhir Anda sudah dikirim otomatis.'
          : 'Jawaban Anda sudah dikirim.',
        tone: timeExpired ? 'amber' : 'emerald'
      })
      pushToast(
        timeExpired ? 'warning' : 'success',
        timeExpired
          ? 'Waktu quiz habis. Jawaban dikirim otomatis.'
          : canShowScoreNow ? 'Quiz selesai. Nilai sudah tersedia.' : 'Quiz selesai. Hasil menunggu publikasi dari guru.'
      )
      if (isSessionPage) {
        navigate('/siswa/quiz', { replace: true })
      }
    } catch (err) {
      if (!handleQuizRequestError(err)) {
        pushToast('error', err?.message || 'Gagal menyelesaikan quiz')
      }
    } finally {
      setIsSubmitting(false)
      autoSubmitLockRef.current = false
    }
  }

  useEffect(() => {
    if (isTaking) return
    violationTriggeredRef.current = false
    releaseStrictIncident()
    setPrivacyShield({ open: false, message: '', reason: '' })
    setViolationPrompt({ open: false, message: '', stage: 1 })
    setSubmitConfirmOpen(false)
    setTextInputFullscreenGraceUntil(0)
  }, [isTaking, releaseStrictIncident])

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
        handleSubmitQuiz(true, { reason: 'time_expired' })
      }
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTaking, selectedQuiz?.id, selectedQuiz?.is_live, selectedQuiz?.live_started_at, selectedQuiz?.duration_minutes, selectedQuiz?.deadline_at, submission?.id, activeSubmission?.id])

  useEffect(() => {
    if (!isTaking || !isStrictSecurity) return

    let editableBlurTimer = null
    let lastTextEditableInteractionAt = getActiveTextEditableElement() ? Date.now() : 0

    const clearEditableBlurTimer = () => {
      if (editableBlurTimer) {
        clearTimeout(editableBlurTimer)
        editableBlurTimer = null
      }
    }

    const markTextEditableInteraction = (target = document.activeElement) => {
      const editable = getTextEditableElement(target)
      if (!editable) return false
      lastTextEditableInteractionAt = Date.now()
      clearEditableBlurTimer()
      setTextInputFocused(true)
      return true
    }

    const isTextInputActiveOrRecent = () => (
      Boolean(getActiveTextEditableElement())
      || Date.now() - lastTextEditableInteractionAt < 2500
    )

    const schedulePostInputFullscreenCheck = () => {
      clearEditableBlurTimer()
      editableBlurTimer = setTimeout(() => {
        editableBlurTimer = null
        const stillEditing = Boolean(getActiveTextEditableElement())
        setTextInputFocused(stillEditing)
        if (!stillEditing && !document.fullscreenElement) {
          setTextInputFullscreenGraceUntil(0)
          lockStrictSession(
            'Fullscreen wajib aktif setelah selesai mengetik jawaban.',
            'fullscreen_exit_after_input'
          )
        }
      }, 700)
    }

    const markFullscreenExitDuringInput = () => {
      const questionId = activeQuestion?.id || ''
      setTextInputFocused(false)
      setTextInputFullscreenGraceUntil(0)
      lockStrictSession(
        'Fullscreen keluar saat mengetik esai. Quiz dikunci sampai Anda kembali fullscreen.',
        'fullscreen_exit_during_essay_input',
        {
          question_id: questionId,
          input_active: true
        }
      )
    }

    const handleEditableFocusIn = (event) => {
      markTextEditableInteraction(event.target)
    }

    const handleEditableFocusOut = (event) => {
      if (!getTextEditableElement(event.target)) return
      schedulePostInputFullscreenCheck()
    }

    const handleEditablePointer = (event) => {
      markTextEditableInteraction(event.target)
    }

    const markScreenshotViolation = async () => {
      lockStrictSession(
        'Percobaan screenshot terdeteksi. Tampilan quiz dikunci untuk menjaga keamanan.',
        'screenshot_attempt',
        { capture_surface: 'keyboard' }
      )
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
        lockStrictSession(
          'Halaman quiz tidak aktif. Tampilan quiz dikunci dan digelapkan.',
          'page_hidden',
          { hidden: true }
        )
      }
    }

    const handlePageLeaving = () => {
      lockStrictSession(
        'Halaman quiz ditinggalkan. Tampilan quiz dikunci dan digelapkan.',
        'page_hidden',
        { lifecycle: 'pagehide' }
      )
    }

    const handleBlur = () => {
      if (document.hidden) return
      if (isTextInputActiveOrRecent()) {
        if (!document.fullscreenElement) {
          markFullscreenExitDuringInput()
        }
        return
      }
      lockStrictSession(
        'Fokus keluar dari halaman quiz. Tampilan dikunci sampai Anda kembali fullscreen.',
        'window_blur'
      )
    }

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      if (active) {
        setTextInputFullscreenGraceUntil(0)
        lockKeyboardShortcuts()
      } else {
        if (isTextInputActiveOrRecent()) {
          markFullscreenExitDuringInput()
          schedulePostInputFullscreenCheck()
          return
        }
        setTextInputFullscreenGraceUntil(0)
        lockStrictSession(
          'Fullscreen ditutup. Quiz dikunci sampai Anda masuk fullscreen lagi.',
          'fullscreen_exit'
        )
      }
    }

    const handleKeydownCapture = (event) => {
      const key = String(event.key || '').toLowerCase()
      const isEditableTarget = Boolean(getTextEditableElement(event.target))
      if (key === 'printscreen') {
        event.preventDefault()
        event.stopPropagation()
        markScreenshotViolation()
        return
      }

      const withCmd = event.ctrlKey || event.metaKey
      const blockedComboKeys = ['t', 'n', 'w', 'l', 'r', 'p', 'j', 'k']
      const isBlockedCombo = withCmd && blockedComboKeys.includes(key)
      const isBlockedSingle = key === 'f11' || key === 'f12'

      if (isEditableTarget) {
        markTextEditableInteraction(event.target)
        if (key === 'tab' || key === 'escape' || isBlockedCombo || isBlockedSingle) {
          event.preventDefault()
          event.stopPropagation()
          lockStrictSession(
            'Shortcut browser dinonaktifkan saat quiz berlangsung.',
            'blocked_shortcut',
            { key: event.key }
          )
        }
        return
      }

      const blockedStrictKeys = new Set(['tab', 'escape', 'control', ' ', 'spacebar'])
      if (blockedStrictKeys.has(key)) {
        event.preventDefault()
        event.stopPropagation()
        const message = `Tombol "${event.key}" dinonaktifkan saat quiz berlangsung.`
        if (key === 'tab' || key === 'escape') {
          lockStrictSession(message, 'blocked_key', { key: event.key })
        } else {
          setViolationMessage(message)
        }
        return
      }

      if (isBlockedCombo || isBlockedSingle) {
        event.preventDefault()
        event.stopPropagation()
        lockStrictSession(
          'Percobaan membuka fitur browser terdeteksi. Quiz dikunci sementara.',
          'blocked_shortcut',
          { key: event.key }
        )
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
      const isEditableTarget = Boolean(getTextEditableElement(event.target))
      if ((event.type === 'selectstart' || event.type === 'selectionchange') && isEditableTarget) {
        markTextEditableInteraction(event.target)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'selectstart') {
        clearTextSelection()
        return
      }
      const message = 'Copy/cut/paste/klik kanan dinonaktifkan saat quiz berlangsung.'
      lockStrictSession(message, 'clipboard_or_context', { action: event.type })
    }

    const clearTextSelection = () => {
      if (getActiveTextEditableElement()) return
      try {
        window.getSelection()?.removeAllRanges()
      } catch {}
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const focusGuard = setInterval(() => {
      if (!document.hasFocus()) {
        if (isTextInputActiveOrRecent()) return
        lockStrictSession(
          'Fokus browser hilang. Tampilan quiz dikunci untuk mencegah kecurangan.',
          'focus_lost'
        )
      }
    }, 800)

    document.documentElement.classList.add('quiz-strict-active')
    document.body.classList.add('quiz-strict-active')
    document.addEventListener('visibilitychange', handleVisibility)
    document.addEventListener('focusin', handleEditableFocusIn, true)
    document.addEventListener('focusout', handleEditableFocusOut, true)
    document.addEventListener('pointerdown', handleEditablePointer, true)
    document.addEventListener('touchstart', handleEditablePointer, true)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('pagehide', handlePageLeaving)
    document.addEventListener('freeze', handlePageLeaving)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('keydown', handleKeydownCapture, true)
    document.addEventListener('keyup', handleKeyupCapture, true)
    document.addEventListener('copy', blockClipboardAndContext, true)
    document.addEventListener('cut', blockClipboardAndContext, true)
    document.addEventListener('paste', blockClipboardAndContext, true)
    document.addEventListener('contextmenu', blockClipboardAndContext, true)
    document.addEventListener('dragstart', blockClipboardAndContext, true)
    document.addEventListener('selectstart', blockClipboardAndContext, true)
    document.addEventListener('selectionchange', clearTextSelection, true)
    window.addEventListener('beforeunload', handleBeforeUnload)
    lockKeyboardShortcuts()

    return () => {
      clearEditableBlurTimer()
      setTextInputFocused(false)
      clearInterval(focusGuard)
      document.documentElement.classList.remove('quiz-strict-active')
      document.body.classList.remove('quiz-strict-active')
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('focusin', handleEditableFocusIn, true)
      document.removeEventListener('focusout', handleEditableFocusOut, true)
      document.removeEventListener('pointerdown', handleEditablePointer, true)
      document.removeEventListener('touchstart', handleEditablePointer, true)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('pagehide', handlePageLeaving)
      document.removeEventListener('freeze', handlePageLeaving)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('keydown', handleKeydownCapture, true)
      document.removeEventListener('keyup', handleKeyupCapture, true)
      document.removeEventListener('copy', blockClipboardAndContext, true)
      document.removeEventListener('cut', blockClipboardAndContext, true)
      document.removeEventListener('paste', blockClipboardAndContext, true)
      document.removeEventListener('contextmenu', blockClipboardAndContext, true)
      document.removeEventListener('dragstart', blockClipboardAndContext, true)
      document.removeEventListener('selectstart', blockClipboardAndContext, true)
      document.removeEventListener('selectionchange', clearTextSelection, true)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unlockKeyboardShortcuts()
    }
  }, [isTaking, isStrictSecurity, selectedQuiz?.id, submission?.id, activeSubmission?.id, activeSubmissionId, activeQuestion?.id, logViolationEvent, lockStrictSession])

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
        const shouldAutoStart = !isStrictSecurity || (
          typeof document !== 'undefined' && Boolean(document.fullscreenElement)
        )
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
          if (!handleQuizRequestError(err)) {
            pushToast('error', err?.message || 'Gagal memulai sesi quiz')
          }
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
    isTaking,
    isStrictSecurity,
    handleQuizRequestError
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
      const stillFullscreen = !isStrictSecurity || (
        typeof document !== 'undefined' && Boolean(document.fullscreenElement)
      )
      const targetQuizId = startCountdown.quizId
      setStartCountdown({ open: false, seconds: 3, quizId: '' })
      if (!stillFullscreen) {
        pushToast('error', FULLSCREEN_REQUIRED_MESSAGE)
        return
      }
      redirectToSessionPage(targetQuizId)
    }, 700)
    return () => clearTimeout(goTimer)
  }, [startCountdown.open, startCountdown.seconds, startCountdown.quizId, isStrictSecurity, pushToast, redirectToSessionPage])

  const handleForceFullscreen = async () => {
    const ok = await requestQuizFullscreen()
    if (!ok) {
      setFullscreenGuideOpen(true)
      pushToast('error', FULLSCREEN_FAILED_MESSAGE)
    } else {
      releaseStrictIncident()
      setPrivacyShield({ open: false, message: '', reason: '' })
      setViolationPrompt({ open: false, message: '', stage: 1 })
      setTextInputFullscreenGraceUntil(0)
      violationTriggeredRef.current = false
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

  const handleFullscreenGuideStart = async () => {
    setFullscreenGuideOpen(false)
    if (isSessionPage && sessionPrepared) {
      await handleManualStartSession()
      return
    }
    await handleStartQuiz()
  }

  const handleResumeStrictSession = async () => {
    const ok = await requestQuizFullscreen()
    if (!ok) {
      setFullscreenGuideOpen(true)
      pushToast('error', FULLSCREEN_FAILED_MESSAGE)
      return
    }
    releaseStrictIncident()
    setPrivacyShield({ open: false, message: '', reason: '' })
    setViolationPrompt({ open: false, message: '', stage: 1 })
    setTextInputFullscreenGraceUntil(0)
    violationTriggeredRef.current = false
    setViolationMessage('Fullscreen aktif. Lanjutkan quiz dengan tetap fokus.')
  }

  const handleOpenSubmitConfirm = () => {
    if (!isTaking || isSubmitting) return
    setSubmitConfirmOpen(true)
  }

  const handleSessionBack = () => {
    if (isTaking) {
      triggerViolationPrompt(
        'Yakin anda keluar quiz? Jika keluar, quiz akan langsung disubmit.',
        'manual_exit_attempt'
      )
      return
    }
    navigate('/siswa/quiz', { replace: true })
  }

  const handleCloseCelebration = () => {
    setCelebration({ open: false, score: null, title: '', message: '', tone: 'emerald' })
  }

  const handleDismissResumeQuiz = () => {
    const quizId = resumeQuizNotice.quiz?.id || ''
    setDismissedResumeQuizId(quizId)
    setResumeQuizNotice({ open: false, quiz: null })
  }

  const handleContinueResumeQuiz = () => {
    const quiz = resumeQuizNotice.quiz
    if (!quiz?.id) {
      setResumeQuizNotice({ open: false, quiz: null })
      return
    }
    setResumeQuizNotice({ open: false, quiz: null })
    setDismissedResumeQuizId('')
    setSelectedQuizId(quiz.id)
    redirectToSessionPage(quiz.id)
  }

  const warningMessage = violationPrompt.open
    ? violationPrompt.message
    : (violationMessage || (
      answerInteractionLocked
        ? 'Pilihan jawaban dikunci. Aktifkan fullscreen lalu klik Batal pada peringatan untuk lanjut.'
        : ''
    ))

  const sessionWarningPanel = isTaking && warningMessage && (
    <div className="rounded-lg bg-red-50 border border-red-200 p-4">
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
            className="px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-700 text-sm font-semibold"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleViolationOk}
            className="px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
          >
            Oke
          </button>
        </div>
      )}
    </div>
  )

  const resumeQuizOverlay = resumeQuizNotice.open && resumeQuizNotice.quiz && (
    <div className="fixed inset-0 z-[1460] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-3xl border border-indigo-200 bg-white p-5 sm:p-6 shadow-2xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-indigo-700">
          Quiz Belum Selesai
        </div>
        <h3 className="mt-4 text-2xl font-black text-slate-900">
          Lanjutkan Quiz?
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Anda masih punya quiz yang belum dikirim. Jika waktu quiz belum habis,
          lanjutkan dari sesi terakhir agar jawaban tidak tertinggal.
        </p>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-base font-black text-slate-900">
            {resumeQuizNotice.quiz.judul || resumeQuizNotice.quiz.title || 'Quiz'}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {resumeQuizNotice.quiz.mapel || '-'} • Deadline: {formatDateTime(getQuizEndAt(resumeQuizNotice.quiz))}
          </div>
        </div>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={handleDismissResumeQuiz}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold"
          >
            Nanti
          </button>
          <button
            type="button"
            onClick={handleContinueResumeQuiz}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm"
          >
            Lanjutkan Quiz
          </button>
        </div>
      </div>
    </div>
  )

  const celebrationOverlay = celebration.open && (
    <div className="fixed inset-0 z-[1300] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-2xl">
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-md ${
          celebration.tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
        }`}>
          {celebration.tone === 'amber' ? <Clock className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
        </div>
        <div>
          <h3 className="mt-4 text-2xl font-bold text-slate-900">
            {celebration.title || 'Quiz Selesai'}
          </h3>
          <p className="mt-2 text-slate-600">
            {celebration.message || 'Jawaban Anda sudah dikirim.'}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2">
            <span className="text-sm text-slate-600">Nilai Anda</span>
            <span className="text-2xl font-bold text-emerald-700">{celebration.score ?? '-'}</span>
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={handleCloseCelebration}
              className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Tutup Notifikasi
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const deviceLockOverlay = deviceLockNotice.open && (
    <div className="fixed inset-0 z-[1450] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-3xl border border-red-200 bg-white p-5 sm:p-6 shadow-2xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
          Perangkat Quiz Dikunci
        </div>
        <h3 className="mt-4 text-2xl font-black text-slate-900">
          Quiz Aktif di Perangkat Lain
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {deviceLockNotice.message}
        </p>
        {deviceLockNotice.retryAfter != null && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Jika perangkat pertama mati atau koneksinya putus, coba lagi sekitar {deviceLockNotice.retryAfter} detik.
          </div>
        )}
        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setDeviceLockNotice({ open: false, message: '', retryAfter: null })}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={() => {
              setDeviceLockNotice({ open: false, message: '', retryAfter: null })
              setQuizDetailsRetryTick((prev) => prev + 1)
            }}
            className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-sm"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    </div>
  )

  const fullscreenGuideModal = fullscreenGuideOpen && isStrictSecurity && (
    <div className="fixed inset-0 z-[1400] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-3xl border border-sky-200 bg-white p-5 sm:p-6 shadow-2xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-700">
          Mode Ketat
        </div>
        <h3 className="mt-4 text-2xl font-black text-slate-900">
          Aktifkan Fullscreen untuk Mulai Quiz
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Browser hanya mengizinkan fullscreen dari klik langsung siswa. Klik tombol di bawah,
          lalu pilih Izinkan pada popup browser agar sesi quiz bisa dimulai.
        </p>
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Jika popup tidak muncul, pastikan tab ini sedang aktif dan izin fullscreen browser tidak diblokir.
        </div>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setFullscreenGuideOpen(false)}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={handleFullscreenGuideStart}
            className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold shadow-sm"
          >
            Izinkan Fullscreen & Mulai
          </button>
        </div>
      </div>
    </div>
  )

  const strictPrivacyShieldOverlay = strictSecurityLocked && (
    <div className="fixed inset-0 z-[1350] bg-black text-white flex items-center justify-center px-4 select-none">
      <div className="w-full max-w-xl text-center">
        <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white/80">
          Mode Strict Aktif
        </div>
        <h3 className="mt-5 text-2xl sm:text-3xl font-black">
          Tampilan Quiz Dikunci
        </h3>
        <p className="mt-3 text-sm sm:text-base leading-7 text-white/75">
          {privacyShield.message || 'Quiz wajib tetap fullscreen dan aktif. Masuk kembali ke fullscreen untuk melanjutkan.'}
        </p>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs sm:text-sm text-white/70">
          Soal dan jawaban sengaja digelapkan ketika fullscreen keluar, tab berpindah,
          halaman tidak fokus, atau ada percobaan screenshot/copy.
        </div>
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={handleResumeStrictSession}
            className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm font-bold shadow-sm"
          >
            Kembali Fullscreen
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Akhiri quiz sekarang? Jawaban akan langsung dikirim.')) {
                void handleSubmitQuiz(true)
              }
            }}
            className="px-5 py-3 rounded-xl border border-white/20 bg-white/10 text-white text-sm font-semibold hover:bg-white/15"
          >
            Akhiri Quiz
          </button>
        </div>
        <div className="mt-4 text-[11px] text-white/45">
          Peringatan tercatat: {violationCount}
        </div>
      </div>
    </div>
  )

  const submitConfirmModal = submitConfirmOpen && isTaking && (
    <div className="fixed inset-0 z-[1320] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center px-4 select-none">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl">
        <div className="text-lg font-black text-slate-900">
          Selesaikan Quiz?
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Jawaban akan dikirim dan tidak bisa diubah lagi. Konfirmasi ini tetap berada di dalam layar fullscreen.
        </p>
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          Ini adalah aksi normal siswa, jadi tidak dihitung sebagai peringatan.
        </div>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setSubmitConfirmOpen(false)}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50"
            disabled={isSubmitting}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void handleSubmitQuiz(false, { confirmed: true })}
            className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold shadow-sm disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Mengirim...' : 'Kirim Jawaban'}
          </button>
        </div>
      </div>
    </div>
  )

  if (isSessionPage) {
    return (
      <div className="fixed inset-0 z-[999] bg-slate-100 overflow-hidden">
        {!selectedQuiz ? (
          <div className="h-full w-full flex items-center justify-center px-6">
            {quizDetailsError ? (
              <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 text-center shadow-sm">
                <div className="text-base font-bold text-red-700">Quiz belum bisa dibuka</div>
                <p className="mt-2 text-sm text-slate-600">
                  {quizDetailsError}
                </p>
                <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    type="button"
                    onClick={retryQuizDetails}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold"
                  >
                    Coba Lagi
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/siswa/quiz', { replace: true })}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold"
                  >
                    Kembali
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center text-slate-600 text-sm sm:text-base font-medium">
                Menyiapkan sesi quiz...
              </div>
            )}
          </div>
        ) : (
          <div className="h-full w-full flex flex-col bg-slate-50 text-slate-950">
            <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
              <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      onClick={handleSessionBack}
                      className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      aria-label={isTaking ? 'Keluar quiz' : 'Kembali ke daftar quiz'}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-bold text-slate-950 sm:text-xl">
                        {selectedQuiz.nama}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span>{selectedQuiz.mapel || '-'}</span>
                        <span className="text-slate-300">/</span>
                        <span>{getModeLabel(selectedQuiz)}</span>
                        <span className="text-slate-300">/</span>
                        <span>Akses {sessionAccessLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {sessionTimerSeconds != null && (
                      <div className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${sessionTimerTone}`}>
                        <Clock className="h-4 w-4" />
                        <span>{formatRemaining(sessionTimerSeconds)}</span>
                      </div>
                    )}
                    {isStrictSecurity && !isFullscreen && isTaking && (
                      <button
                        type="button"
                        onClick={handleForceFullscreen}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        <Expand className="h-4 w-4" />
                        Fullscreen
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleOpenSubmitConfirm}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!isTaking || isSubmitting}
                    >
                      <Send className="h-4 w-4" />
                      {isSubmitting ? 'Mengirim' : 'Kirim'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Progress {answeredCount}/{totalQuestions}</span>
                      <span>{answeredPercent}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                        style={{ width: `${answeredPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${
                    isStrictSecurity
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}>
                    {isStrictSecurity ? <Lock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    <span>{sessionModeLabel}</span>
                  </div>
                </div>
              </div>
            </header>

            <main className="relative flex-1 overflow-y-auto select-none">
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {watermarkSeed.map((wm) => (
                  <div
                    key={wm.id}
                    className="absolute text-[11px] font-semibold text-slate-300/45 rotate-[-20deg] whitespace-nowrap"
                    style={{ top: `${wm.top}%`, left: `${wm.left}%` }}
                  >
                    {watermarkText}
                  </div>
                ))}
              </div>

              <div className="relative z-10 mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-5 lg:py-6">
                {celebrationOverlay}
                {sessionWarningPanel}

                {!isTaking && (
                  <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                          <Flag className="h-3.5 w-3.5" />
                          Sesi quiz
                        </div>
                        <h2 className="mt-3 text-xl font-bold text-slate-950">Mulai pengerjaan</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {isStrictSecurity
                            ? sessionNeedsManualStart
                              ? 'Aktifkan fullscreen untuk membuka soal.'
                              : 'Fullscreen akan aktif sebelum soal dibuka.'
                            : 'Sesi akan memakai timer dan validasi server.'}
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center sm:w-64">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-lg font-bold text-slate-950">{totalQuestions}</div>
                          <div className="text-[11px] text-slate-500">Soal</div>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-lg font-bold text-slate-950">{getModeLabel(selectedQuiz)}</div>
                          <div className="text-[11px] text-slate-500">Mode</div>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="truncate text-lg font-bold text-slate-950">{sessionAccessLabel}</div>
                          <div className="text-[11px] text-slate-500">Akses</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <div>
                        <label htmlFor="quiz-session-access-code" className="text-xs font-semibold text-slate-600">Kode Akses</label>
                        <input
                          id="quiz-session-access-code"
                          name="quiz_access_code"
                          aria-label="Kode akses quiz"
                          type="password"
                          className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                          value={accessCodeInput}
                          onChange={(e) => setAccessCodeInput(e.target.value)}
                          placeholder="Isi jika diberikan guru"
                        />
                      </div>
                      {sessionPrepared && (
                        <button
                          type="button"
                          onClick={handleManualStartSession}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
                        >
                          {isStrictSecurity ? <Expand className="h-4 w-4" /> : <Flag className="h-4 w-4" />}
                          {isStrictSecurity ? 'Fullscreen & Mulai' : 'Mulai'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {(quizDetailsLoading || quizDetailsLoadedForId !== selectedQuiz.id) && (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                    Menyiapkan soal quiz...
                  </div>
                )}

                {!!quizDetailsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span>Gagal memuat soal quiz: {quizDetailsError}</span>
                      <button
                        type="button"
                        onClick={retryQuizDetails}
                        className="inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        Coba Lagi
                      </button>
                    </div>
                  </div>
                )}

                {!quizDetailsLoading && quizDetailsLoadedForId !== selectedQuiz.id && !quizDetailsError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span>Detail quiz belum siap.</span>
                      <button
                        type="button"
                        onClick={retryQuizDetails}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        Muat ulang
                      </button>
                    </div>
                  </div>
                )}

                {isTaking && quizDetailsLoadedForId === selectedQuiz.id && !quizDetailsLoading && (
                  <div className="relative">
                    {strictAnswerBlock && (
                      <div className="absolute inset-0 z-20 rounded-lg bg-slate-200/45 backdrop-blur-[1px] cursor-not-allowed" />
                    )}

                    <div className={`grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] ${strictAnswerBlock ? 'pointer-events-none' : ''}`}>
                      <section className="min-w-0 space-y-4">
                        {!!activeQuestion && (
                          <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-indigo-700">
                                      Soal {activeQuestionIndex + 1} dari {totalQuestions}
                                    </span>
                                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                                      activeQuestionType === 'essay'
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-blue-200 bg-blue-50 text-blue-700'
                                    }`}>
                                      {activeQuestionType === 'essay' ? 'Esai' : 'Pilihan ganda'}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-sm font-semibold text-slate-600">
                                  {activeQuestion.poin} poin
                                </div>
                              </div>
                            </div>

                            <div className="space-y-5 px-4 py-5 sm:px-5">
                              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                  Soal
                                </div>
                                <div className="whitespace-pre-line text-base leading-7 text-slate-950">
                                  {activeQuestion.soal}
                                </div>
                              </div>

                              {!!activeQuestionImagePath && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewMediaUrl(getQuizImageUrl(activeQuestionImagePath))}
                                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:border-indigo-200"
                                  aria-label={`Perbesar gambar soal ${activeQuestionIndex + 1}`}
                                >
                                  <img
                                    src={getQuizImageUrl(activeQuestionImagePath)}
                                    alt={`Gambar soal ${activeQuestionIndex + 1}`}
                                    className="mx-auto block max-h-[24rem] w-auto max-w-full rounded-md object-contain"
                                    decoding="async"
                                  />
                                </button>
                              )}

                              {activeQuestionType === 'essay' ? (
                                <div>
                                  <textarea
                                    name="quiz_essay_answer"
                                    aria-label={`Jawaban esai soal ${activeQuestionIndex + 1}`}
                                    rows="10"
                                    value={String(answers[activeQuestion.id] || '')}
                                    onChange={(e) => handleEssayChange(activeQuestion.id, e.target.value)}
                                    onBlur={(e) => handleEssayBlur(activeQuestion.id, e.target.value)}
                                    disabled={answerInteractionLocked}
                                    placeholder="Tulis jawaban esai Anda di sini..."
                                    className={`min-h-[16rem] w-full resize-y rounded-lg border px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${
                                      answerInteractionLocked
                                        ? 'border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed'
                                        : 'border-slate-300 bg-white'
                                    }`}
                                  />
                                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Jawaban tersimpan otomatis.
                                  </div>
                                </div>
                              ) : (
                                (() => {
                                  const mcqOptions = (optionsByQuestion[activeQuestion.id] || [])
                                    .slice()
                                    .sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'id'))
                                  return (
                                    <div className="space-y-3">
                                      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                        Pilihan jawaban
                                      </div>
                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        {mcqOptions.map((opt) => {
                                          const selected = answers[activeQuestion.id] === opt.id
                                          const disabled = answerInteractionLocked
                                          const optionImagePath = getQuizItemImagePath(opt)
                                          return (
                                            <div key={opt.id} className="space-y-2">
                                              <button
                                                type="button"
                                                onClick={() => saveAnswer(activeQuestion.id, opt.id, 'mcq')}
                                                disabled={disabled}
                                                className={`group flex min-h-[64px] w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                                  selected
                                                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm'
                                                    : disabled
                                                      ? 'border-slate-200 bg-slate-50 text-slate-500'
                                                      : 'border-slate-200 bg-white text-slate-800 hover:border-indigo-200 hover:bg-indigo-50/40'
                                                } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
                                              >
                                                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-sm font-bold ${
                                                  selected
                                                    ? 'border-indigo-600 bg-indigo-600 text-white'
                                                    : 'border-slate-300 bg-white text-slate-700'
                                                }`}>
                                                  {opt.label}
                                                </span>
                                                <span className="min-w-0 flex-1 text-sm leading-6">{opt.text}</span>
                                                {selected && <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-indigo-600" />}
                                              </button>
                                              {!!optionImagePath && (
                                                <button
                                                  type="button"
                                                  onClick={() => setPreviewMediaUrl(getQuizImageUrl(optionImagePath))}
                                                  className="inline-flex max-w-full flex-col rounded-lg border border-slate-200 bg-slate-50 p-2 hover:border-indigo-200"
                                                  aria-label={`Perbesar gambar opsi ${opt.label}`}
                                                >
                                                  <img
                                                    src={getQuizImageUrl(optionImagePath)}
                                                    alt={`Gambar opsi ${opt.label}`}
                                                    className="block max-h-56 w-auto max-w-full rounded-md object-contain"
                                                    loading="lazy"
                                                    decoding="async"
                                                  />
                                                </button>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })()
                              )}
                            </div>
                          </article>
                        )}

                        {!!activeQuestion && (
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveQuestionIndex((prev) => Math.max(0, prev - 1))}
                              disabled={activeQuestionIndex <= 0 || strictAnswerBlock || isSubmitting}
                              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Sebelumnya
                            </button>
                            <div className="hidden text-xs font-medium text-slate-500 sm:block">
                              {activeQuestionIndex + 1} / {questions.length}
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                              disabled={activeQuestionIndex >= questions.length - 1 || strictAnswerBlock || isSubmitting}
                              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Berikutnya
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </section>

                      {!!questions.length && (
                        <aside className="lg:sticky lg:top-4 h-fit space-y-4">
                          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <ListChecks className="h-4 w-4 text-indigo-600" />
                                Navigasi
                              </div>
                              <span className="text-xs text-slate-500">{unansweredCount} belum</span>
                            </div>
                            <div className="mt-3 grid grid-cols-5 gap-2 lg:grid-cols-4">
                              {questions.map((q, index) => {
                                const isActive = index === activeQuestionIndex
                                const isAnswered = isQuestionAnswered(q)
                                const numberLabel = index + 1
                                return (
                                  <button
                                    key={q.id}
                                    type="button"
                                    onClick={() => setActiveQuestionIndex(index)}
                                    disabled={strictAnswerBlock || isSubmitting}
                                    className={`h-9 rounded-md border text-sm font-semibold transition ${
                                      isActive
                                        ? 'border-indigo-600 bg-indigo-600 text-white'
                                        : isAnswered
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    } ${
                                      strictAnswerBlock || isSubmitting
                                        ? 'cursor-not-allowed opacity-70'
                                        : ''
                                    }`}
                                  >
                                    {numberLabel}
                                  </button>
                                )
                              })}
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                                <div className="font-bold">{answeredCount}</div>
                                <div>Terjawab</div>
                              </div>
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                                <div className="font-bold">{unansweredCount}</div>
                                <div>Belum</div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${
                                isStrictSecurity ? 'text-amber-600' : 'text-slate-400'
                              }`} />
                              <div>
                                <div className="font-semibold text-slate-800">{sessionModeLabel}</div>
                                <div className="mt-1 leading-5">
                                  {isStrictSecurity
                                    ? 'Tetap fullscreen sampai jawaban dikirim.'
                                    : 'Jawaban tersimpan otomatis saat dipilih.'}
                                </div>
                              </div>
                            </div>
                          </div>
                        </aside>
                      )}
                    </div>
                  </div>
                )}

                {quizDetailsLoadedForId === selectedQuiz.id && !quizDetailsLoading && !questions.length && (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500 shadow-sm">
                    Quiz belum memiliki soal.
                  </div>
                )}
              </div>
            </main>
          </div>
        )}
        {previewMediaUrl && (
          <FilePreviewModal
            fileUrl={previewMediaUrl}
            onClose={() => setPreviewMediaUrl('')}
          />
        )}
        {submitConfirmModal}
        {strictPrivacyShieldOverlay}
        {fullscreenGuideModal}
        {deviceLockOverlay}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50/40 to-blue-50/50 py-6 px-4 sm:px-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="page-title-card">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-cyan-500 to-blue-600 rounded-full"></div>
              <div>
                <h1 className="page-title-heading">Quiz Siswa</h1>
                <p className="page-title-description">Kerjakan quiz sesuai jadwal yang ditentukan guru.</p>
              </div>
            </div>
            <div className="sismu-toolbar-filters sismu-toolbar-filters--student w-full lg:w-auto">
              <div className="sismu-toolbar-card bg-gradient-to-r from-slate-50 to-indigo-50 border-indigo-100">
                <div className="text-xs text-slate-500">Siswa</div>
                <div className="truncate font-semibold text-slate-800">{profile?.nama || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">Kelas: {kelasId || '-'}</div>
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
                className="min-w-0"
                compact
              />
              <select
                name="quiz_mapel_filter"
                aria-label="Filter mapel quiz"
                className="sismu-toolbar-control border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                name="quiz_month_filter"
                aria-label="Filter bulan quiz"
                className="sismu-toolbar-control border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              <button
                type="button"
                onClick={loadQuizzes}
                className="sismu-toolbar-button bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition-colors"
              >
                Muat Ulang
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1.5 rounded-full bg-indigo-600"></div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Daftar Quiz</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{filteredQuizzes.length} quiz ditampilkan</p>
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
            <div className="p-5 space-y-3 min-h-[30rem] max-h-[calc(100vh-130px)] overflow-y-auto">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span>
                  Berlangsung: {quizStatusSummary.active}
                </span>
                <span>
                  Akan datang: {quizStatusSummary.scheduled}
                </span>
                <span>
                  Selesai: {quizStatusSummary.done}
                </span>
              </div>
              {filteredQuizzes.length === 0 && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4">
                  Belum ada quiz untuk kelas ini.
                </div>
              )}
              {filteredQuizzes.map((q) => {
                const status = getQuizStatus(q, q.submission, nowTick)
                const mutationMeta = getQuizMutationMeta(q)
                const canViewResult = Boolean(q.result_visible_to_students)
                const countdownMeta = getQuizCountdownMeta(q, status, nowTick)
                const quizEndAt = getQuizEndAt(q)
                const quizEndLabel = normalizeMode(q) === 'regular' ? 'Deadline' : 'Selesai'
                const durationText = q.submission?.started_at
                  ? formatDurationText(q.submission.started_at, q.submission.finished_at || nowTick)
                  : null
                const isSelected = selectedQuizId === q.id
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuizId(q.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">{q.nama}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {q.mapel || '-'} • {getModeLabel(q)} • Akses {getAccessDeviceLabel(q.access_device)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-slate-500">
                      <div>
                        <span className="block font-medium text-slate-700">Mulai</span>
                        <span>{q.starts_at ? formatDateTime(q.starts_at) : '-'}</span>
                      </div>
                      <div>
                        <span className="block font-medium text-slate-700">{quizEndLabel}</span>
                        <span>{quizEndAt ? formatDateTime(quizEndAt) : '-'}</span>
                      </div>
                    </div>
                    {countdownMeta && (
                      <div className={`mt-3 rounded-lg border px-3 py-2 ${countdownMeta.tone}`}>
                        <div className="text-[11px] font-semibold">{countdownMeta.label}</div>
                        <div className="mt-1 text-sm font-bold leading-none">
                          {formatRemaining(countdownMeta.seconds)}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span>{mutationMeta.label}</span>
                      <span>Hasil: {canViewResult ? 'Bisa dilihat' : 'Disembunyikan'}</span>
                      {canViewResult && q.submission?.score != null && (
                        <span>Nilai: {q.submission.score}</span>
                      )}
                      {durationText && (
                        <span>Durasi: {durationText}</span>
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
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-1.5 rounded-full bg-teal-600"></div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{selectedQuiz.nama}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
                        <span>{selectedQuiz.mapel}</span>
                        <span>•</span>
                        <span>Mode {getModeLabel(selectedQuiz)}</span>
                        <span>•</span>
                        <span>Akses {getAccessDeviceLabel(selectedQuiz.access_device)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {selectedStatus && (
                      <span className={`rounded-md border px-2.5 py-1 text-xs ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    )}
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                      {getQuizMutationMeta(selectedQuiz).label}
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

                <div className="p-5">
                  <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500">Tanggal Mulai</div>
                      <div className="text-sm text-slate-800 mt-1 font-semibold">
                        {selectedQuiz.starts_at ? formatDateTime(selectedQuiz.starts_at) : '-'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {normalizeMode(selectedQuiz) === 'regular' ? 'Deadline' : 'Selesai'}
                      </div>
                      <div className="text-sm text-slate-800 mt-1 font-semibold">
                        {getQuizEndAt(selectedQuiz) ? formatDateTime(getQuizEndAt(selectedQuiz)) : 'Tidak ada'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Jumlah Soal</div>
                      <div className="text-xl font-bold text-slate-900">{totalQuestions}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Terjawab</div>
                      <div className="text-xl font-bold text-slate-900">{answeredCount}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Nilai</div>
                      <div className="text-xl font-bold text-slate-900">
                        {canViewSelectedResult ? (activeSubmission?.score ?? '-') : '-'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Durasi Anda</div>
                      <div className="text-xl font-bold text-slate-900">{activeDurationText}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">Ruang Persiapan Quiz</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {isStrictSecurity ? 'Mode strict: fullscreen wajib aktif.' : 'Mode standard.'} Akses {getAccessDeviceLabel(selectedQuiz.access_device)}.
                      </div>
                      {selectedWebAccessBlocked && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          {selectedWebAccessBlockMessage}
                        </div>
                      )}
                      <div className="mt-3 max-w-sm">
                        <label htmlFor="quiz-inline-access-code" className="text-xs font-semibold text-slate-600">Kode Akses</label>
                        <input
                          id="quiz-inline-access-code"
                          name="quiz_access_code_inline"
                          aria-label="Kode akses quiz"
                          type="password"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                          value={accessCodeInput}
                          onChange={(e) => setAccessCodeInput(e.target.value)}
                          placeholder="Isi jika diberikan guru"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row xl:flex-col xl:min-w-[220px]">
                      {selectedCanStartInWeb && (
                        <button
                          type="button"
                          onClick={handleStartQuiz}
                          disabled={isStartCountdownActive}
                          className={`rounded-lg px-5 py-2.5 font-semibold text-white shadow-sm transition-colors ${
                            isStartCountdownActive
                              ? 'bg-indigo-300 cursor-not-allowed'
                              : 'bg-indigo-600 hover:bg-indigo-700'
                          }`}
                        >
                          {isStartCountdownActive
                            ? `Mulai dalam ${Math.max(startCountdown.seconds, 0)}`
                            : activeSubmission?.status === 'ongoing'
                              ? (isStrictSecurity ? 'Izinkan Fullscreen & Lanjutkan' : 'Lanjutkan Quiz')
                              : (isStrictSecurity ? 'Izinkan Fullscreen & Mulai' : 'Mulai Quiz')}
                        </button>
                      )}
                      {!selectedCanStartInWeb && (
                        <button
                          type="button"
                          disabled
                          className="cursor-not-allowed rounded-lg bg-slate-100 px-5 py-2.5 font-semibold text-slate-400"
                        >
                          {selectedWebAccessBlocked ? 'Akses Mobile Saja' : 'Quiz belum tersedia'}
                        </button>
                      )}
                      {activeSubmission?.score != null && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700">
                          {canViewSelectedResult ? 'Nilai sudah keluar.' : 'Nilai sudah keluar, tapi masih disembunyikan guru.'}
                        </div>
                      )}
                      {canViewSelectedResult && (
                        <button
                          type="button"
                          onClick={() => setShowResultDetail(true)}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-5 py-2.5 font-semibold text-indigo-700 hover:bg-indigo-100"
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
                  const questionImagePath = getQuizItemImagePath(question)

                  return (
                    <div key={question.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          Soal {idx + 1}
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

                      {!!questionImagePath && (
                        <div className="mt-3">
                          <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <img
                              src={getQuizImageUrl(questionImagePath)}
                              alt={`Gambar soal ${idx + 1}`}
                              className="block max-h-56 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                              onClick={() => setPreviewMediaUrl(getQuizImageUrl(questionImagePath))}
                              loading="lazy"
                              decoding="async"
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
                              const optionImagePath = getQuizItemImagePath(opt)
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
                                  {!!optionImagePath && (
                                    <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                                      <img
                                        src={getQuizImageUrl(optionImagePath)}
                                        alt={`Gambar opsi ${opt.label}`}
                                        className="block max-h-52 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                                        onClick={() => setPreviewMediaUrl(getQuizImageUrl(optionImagePath))}
                                        loading="lazy"
                                        decoding="async"
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
        {resumeQuizOverlay}
        {fullscreenGuideModal}

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
