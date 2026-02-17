import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

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

const FULLSCREEN_REQUIRED_MESSAGE = 'Quiz wajib mode fullscreen. Klik Izinkan Fullscreen di browser untuk mulai.'
const FULLSCREEN_FAILED_MESSAGE = 'Gagal masuk fullscreen. Aktifkan izin fullscreen pada browser lalu coba lagi.'

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
  const [selectedQuizId, setSelectedQuizId] = useState(() => sessionQuizIdParam || '')
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [quizDetailsLoading, setQuizDetailsLoading] = useState(false)
  const [quizDetailsLoadedForId, setQuizDetailsLoadedForId] = useState('')
  const [quizDetailsError, setQuizDetailsError] = useState('')
  const [quizDetailsRetryTick, setQuizDetailsRetryTick] = useState(0)
  const [answers, setAnswers] = useState({})
  const [answerIds, setAnswerIds] = useState({})
  const [submission, setSubmission] = useState(null)
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

  const kelasId = profile?.kelas || profile?.kelas_id || ''

  const filteredQuizzes = useMemo(() => {
    if (!selectedMapel) return quizList
    return quizList.filter((q) => q.mapel === selectedMapel)
  }, [quizList, selectedMapel])

  const selectedQuizPool = isSessionPage ? quizList : filteredQuizzes

  const selectedQuiz = useMemo(() => (
    selectedQuizPool.find((q) => q.id === selectedQuizId) || null
  ), [selectedQuizPool, selectedQuizId])

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

  const selectedStatus = useMemo(() => (
    selectedQuiz ? getQuizStatus(selectedQuiz, activeSubmission, nowTick) : null
  ), [selectedQuiz, activeSubmission, nowTick])

  const selectedRemainingSeconds = useMemo(() => {
    if (!selectedQuiz || !selectedStatus || selectedStatus.kind !== 'active') return null
    const endAt = selectedQuiz.is_live ? getLiveEndAt(selectedQuiz) : safeDate(selectedQuiz.deadline_at)
    if (!endAt) return null
    return Math.floor((endAt.getTime() - nowTick.getTime()) / 1000)
  }, [selectedQuiz, selectedStatus, nowTick])

  const activeDurationText = useMemo(() => {
    if (!activeSubmission?.started_at) return '-'
    return formatDurationText(activeSubmission.started_at, activeSubmission.finished_at || nowTick)
  }, [activeSubmission?.started_at, activeSubmission?.finished_at, nowTick])

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
    Object.values(answers).filter(Boolean).length
  ), [answers])

  const totalQuestions = questions.length

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
      if (merged.length && !selectedQuizId) {
        setSelectedQuizId(merged[0].id)
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
  }, [user?.id, kelasId])

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
      if (submissionRow?.id) {
        const { data: answerRows, error: answerError } = await supabase
          .from('quiz_answers')
          .select('*')
          .eq('submission_id', submissionRow.id)
        if (answerError) throw answerError

        ;(answerRows || []).forEach((row) => {
          answerMap[row.question_id] = row.option_id
          answerIdMap[row.question_id] = row.id
        })
      }

      setQuestions(questionRows || [])
      setOptionsByQuestion(grouped)
      setAnswers(answerMap)
      setAnswerIds(answerIdMap)
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
  }, [selectedQuizId, selectedQuiz?.id, selectedQuiz?.submission?.id, user?.id, quizDetailsRetryTick])

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

  const saveAnswer = async (questionId, optionId) => {
    if (!selectedQuiz) return
    const sub = await ensureSubmission()
    if (!sub?.id) return

    const answerId = answerIds[questionId] || makeId()
    const nowIso = new Date().toISOString()
    const payload = {
      id: answerId,
      submission_id: sub.id,
      question_id: questionId,
      option_id: optionId,
      created_at: nowIso,
      updated_at: nowIso
    }

    const { error } = await supabase
      .from('quiz_answers')
      .upsert(payload, { onConflict: 'submission_id,question_id' })

    if (error) {
      pushToast('error', error?.message || 'Gagal menyimpan jawaban')
      return
    }

    setAnswers((prev) => ({ ...prev, [questionId]: optionId }))
    setAnswerIds((prev) => ({ ...prev, [questionId]: answerId }))
  }

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
      const { data, error } = await supabase.quiz.submit({
        quiz_id: selectedQuiz.id,
        submission_id: sub.id
      })
      if (error) throw error

      const score = data?.score ?? null
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
      setCelebration({ open: true, score })
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen()
        } catch {}
      }
      pushToast('success', 'Quiz selesai. Nilai sudah tersedia.')
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
      triggerViolationPrompt('Percobaan screenshot terdeteksi saat quiz berjalan.')
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
        triggerViolationPrompt('Anda keluar dari halaman quiz.')
      }
    }

    const handleBlur = () => {
      if (document.hidden) return
      triggerViolationPrompt('Anda berpindah aplikasi/tab saat quiz berjalan.')
    }

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      if (active) {
        lockKeyboardShortcuts()
      } else {
        triggerViolationPrompt('Fullscreen ditutup saat quiz berjalan.')
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
        setViolationMessage(`Tombol "${event.key}" dinonaktifkan saat quiz berlangsung.`)
        return
      }

      const withCmd = event.ctrlKey || event.metaKey
      const blockedComboKeys = ['t', 'n', 'w', 'l', 'r', 'p', 'j', 'k']
      const isBlockedCombo = withCmd && blockedComboKeys.includes(key)
      const isBlockedSingle = key === 'f11' || key === 'f12'
      if (isBlockedCombo || isBlockedSingle) {
        event.preventDefault()
        event.stopPropagation()
        triggerViolationPrompt('Percobaan membuka fitur browser terdeteksi.')
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
      setViolationMessage('Copy/cut/klik kanan dinonaktifkan saat quiz berlangsung.')
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const focusGuard = setInterval(() => {
      if (!document.hasFocus()) {
        triggerViolationPrompt('Fokus browser hilang saat quiz berjalan.')
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
  }, [isTaking, selectedQuiz?.id, submission?.id, activeSubmission?.id])

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

  const violationPanel = isTaking && violationPrompt.open && (
    <div className="rounded-2xl bg-red-50 border border-red-200 p-4">
      <div className="text-base font-bold text-red-700">Peringatan Ujian</div>
      <p className="text-sm text-slate-700 mt-2">{violationPrompt.message}</p>
      <p className="text-sm text-slate-600 mt-2">
        {violationPrompt.stage === 1
          ? 'Klik Oke jika ingin melanjutkan proses keluar quiz, atau Batal untuk kembali mengerjakan.'
          : 'Konfirmasi terakhir. Jika klik Oke, quiz akan disubmit dan dianggap selesai.'}
      </p>
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
    </div>
  )

  const celebrationPanel = celebration.open && (
    <div className="relative w-full rounded-2xl bg-emerald-50 border border-emerald-200 p-4 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        {sparkleItems.map((item) => (
          <span
            key={item.id}
            className="absolute text-xl animate-pulse"
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              animationDelay: `${item.delay}s`
            }}
          >
            {item.icon}
          </span>
        ))}
      </div>
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-emerald-700">Quiz berhasil diselesaikan</div>
          <div className="text-sm text-slate-700 mt-1">
            Nilai Anda: <span className="font-semibold">{celebration.score ?? '-'}</span>
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={handleCloseCelebration}
            className="px-4 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
          >
            Tutup
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
                    <div className="text-xs px-3 py-1 rounded-full bg-indigo-100 text-indigo-700">
                      Sisa waktu: {formatRemaining(remainingSeconds ?? selectedRemainingSeconds)}
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
                {celebrationPanel}
                {violationPanel}

                {violationMessage && (
                  <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm flex items-center justify-between">
                    <div>{violationMessage}</div>
                    <div className="text-xs">Peringatan: {violationCount}</div>
                  </div>
                )}

                {!isTaking && (
                  <div className="px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-sm text-indigo-700">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span>
                        {sessionNeedsManualStart
                          ? 'Izin fullscreen ditolak browser. Klik tombol di samping untuk mulai quiz.'
                          : 'Klik tombol di samping untuk mulai quiz dalam mode fullscreen.'}
                      </span>
                      {sessionPrepared && (
                        <button
                          type="button"
                          onClick={handleManualStartSession}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                        >
                          Masuk Fullscreen & Mulai Quiz
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

                {quizDetailsLoadedForId === selectedQuiz.id && !quizDetailsLoading && questions.map((q) => (
                  <div key={q.id} className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-slate-900">Soal {q.nomor}</div>
                      <div className="text-xs text-slate-500">{q.poin} poin</div>
                    </div>
                    <div className="text-sm text-slate-700 mb-4">{q.soal}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(optionsByQuestion[q.id] || [])
                        .sort((a, b) => a.label.localeCompare(b.label))
                        .map((opt) => {
                          const selected = answers[q.id] === opt.id
                          const disabled = !isTaking || isSubmitting
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => saveAnswer(q.id, opt.id)}
                              disabled={disabled}
                              className={`text-left px-4 py-3 rounded-2xl border transition ${
                                selected
                                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                  : 'border-slate-200 hover:bg-slate-50'
                              } ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
                            >
                              <span className="font-semibold mr-2">{opt.label}.</span>
                              {opt.text}
                            </button>
                          )
                        })}
                    </div>
                  </div>
                ))}

                {quizDetailsLoadedForId === selectedQuiz.id && !quizDetailsLoading && !questions.length && (
                  <div className="text-sm text-slate-500">Quiz belum memiliki soal.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 py-6 px-4 sm:px-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-indigo-500 to-purple-600 rounded-full"></div>
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
              <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                {selectedMapel || 'Semua mapel'}
              </span>
            </div>
            <div className="p-5 space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto">
              {filteredQuizzes.length === 0 && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4">
                  Belum ada quiz untuk kelas ini.
                </div>
              )}
              {filteredQuizzes.map((q) => {
                const status = getQuizStatus(q, q.submission, nowTick)
                const durationText = q.submission?.started_at
                  ? formatDurationText(q.submission.started_at, q.submission.finished_at || nowTick)
                  : null
                const endAt = q.is_live ? getLiveEndAt(q) : safeDate(q.deadline_at)
                const remainingOnCard = status.kind === 'active' && endAt
                  ? Math.floor((endAt.getTime() - nowTick.getTime()) / 1000)
                  : null
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuizId(q.id)}
                    className={`w-full text-left border-2 rounded-2xl p-4 transition-all duration-300 ${
                      selectedQuizId === q.id
                        ? 'border-indigo-400 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-sm shadow-indigo-100/60'
                        : status.kind === 'expired'
                          ? 'border-red-200 bg-gradient-to-r from-red-50/90 to-rose-50/40 hover:border-red-300 hover:shadow-sm'
                          : status.kind === 'active' || status.kind === 'done'
                            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/90 to-green-50/40 hover:border-emerald-300 hover:shadow-sm'
                            : 'border-amber-200 bg-gradient-to-r from-amber-50/90 to-yellow-50/40 hover:border-amber-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900">{q.nama}</div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {q.mapel} | Mode {getModeLabel(q)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Mulai: {q.starts_at ? formatDateTime(q.starts_at) : '-'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Selesai: {q.deadline_at ? formatDateTime(q.deadline_at) : '-'}
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {q.submission?.score != null && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                          Nilai: {q.submission.score}
                        </span>
                      )}
                      {durationText && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                          Durasi: {durationText}
                        </span>
                      )}
                      {remainingOnCard != null && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          Sisa: {formatRemaining(remainingOnCard)}
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
                    <div className="w-2 h-8 bg-purple-600 rounded-full"></div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{selectedQuiz.nama}</h3>
                      <div className="text-sm text-slate-500 mt-1">
                        {selectedQuiz.mapel} | Mode {getModeLabel(selectedQuiz)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Mulai: {selectedQuiz.starts_at ? formatDateTime(selectedQuiz.starts_at) : '-'}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Selesai: {selectedQuiz.deadline_at ? formatDateTime(selectedQuiz.deadline_at) : 'Tidak ada'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {selectedStatus && (
                      <span className={`text-xs px-3 py-1 rounded-full ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    )}
                    {selectedStatus?.kind === 'active' && selectedRemainingSeconds != null && (
                      <span className="text-xs font-semibold text-emerald-700">
                        Sisa waktu: {formatRemaining(selectedRemainingSeconds)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-5">
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
                        {activeSubmission?.score ?? '-'}
                      </div>
                    </div>
                    <div className="border border-amber-200 rounded-2xl p-3 bg-gradient-to-r from-amber-50 to-yellow-50">
                      <div className="text-xs text-slate-500">Durasi Anda</div>
                      <div className="text-xl font-bold text-slate-900">{activeDurationText}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {selectedStatus?.canStart && (
                      <button
                        type="button"
                        onClick={handleStartQuiz}
                        disabled={isStartCountdownActive}
                        className={`px-5 py-2.5 rounded-2xl text-white font-semibold transition-colors shadow-sm ${
                          isStartCountdownActive
                            ? 'bg-indigo-300 cursor-not-allowed'
                            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'
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
                      <div className="text-sm text-slate-600 flex items-center">
                        Nilai sudah keluar.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {celebrationPanel}

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
