// src/pages/guru/quiz/quizUtils.js

import { parseDateTime } from '../../../lib/time'
import {
  getAssessmentSlotLabel,
  normalizeAssessmentSlot
} from '../../../utils/academicAssessment'

export const POINT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30]
export const QUIZ_MAX_POINTS = 100
export const QUIZ_IMAGE_MAX_BYTES = 70 * 1024
export const QUIZ_IMAGE_ALLOWED_EXT = ['jpg', 'jpeg', 'png']
export const QUIZ_IMAGE_ALLOWED_MIME = ['image/jpeg', 'image/png']
export const MONTH_FILTER_ALL = ''
export const MONTH_FILTER_THIS = '__this_month'
export const MONTH_FILTER_LAST_12 = '__last_12_months'

export const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const normalizeMapel = (v) => (v || '').toString().trim()

export const toBoolean = (value) => (
  value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'
)

export const getFileExtension = (name = '') => {
  const normalized = String(name || '').split('?')[0].toLowerCase()
  const parts = normalized.split('.')
  if (parts.length < 2) return ''
  return parts.pop() || ''
}

export const isSupportedQuizImage = (file) => {
  if (!file) return false
  const ext = getFileExtension(file.name || '')
  const mime = String(file.type || '').toLowerCase()
  return QUIZ_IMAGE_ALLOWED_EXT.includes(ext) && QUIZ_IMAGE_ALLOWED_MIME.includes(mime)
}

export const formatBytesLabel = (bytes) => {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  const kb = value / 1024
  if (kb < 1024) return `${Math.round(kb * 10) / 10} KB`
  const mb = kb / 1024
  return `${Math.round(mb * 100) / 100} MB`
}

export const safeDate = (value) => {
  return parseDateTime(value)
}

export const toMinuteDate = (value) => {
  const d = safeDate(value)
  if (!d) return null
  d.setSeconds(0, 0)
  return d
}

export const getNowLocalInput = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export const toLocalInput = (value) => {
  const d = safeDate(value)
  if (!d) return ''
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export const formatRemaining = (seconds) => {
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

export const formatDurationText = (startedAtValue, endedAtValue = new Date()) => {
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

export const normalizeMode = (quiz) => {
  return normalizeAssessmentSlot(quiz?.mode, { isLive: Boolean(quiz?.is_live) })
}

export const getModeLabel = (quiz, semester = quiz?.semester) => {
  const mode = normalizeMode(quiz)
  return `Mode ${getAssessmentSlotLabel(mode, semester, { formal: mode !== 'regular' })}`
}

export const normalizeQuestionType = (value) => {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'essay') return 'essay'
  return 'mcq'
}

export const getQuestionTypeLabel = (value) => (
  normalizeQuestionType(value) === 'essay' ? 'Esai' : 'Pilihan Ganda'
)

export const normalizeQuestionNumbering = (questionRows = []) => (
  (questionRows || []).map((question, index) => ({
    ...question,
    nomor: index + 1
  }))
)

export const sortQuestionsByExamFlow = (questionRows = []) => {
  const rows = Array.isArray(questionRows) ? questionRows : []
  const indexed = rows.map((question, index) => ({ question, index }))
  const sortPart = (type) => indexed
    .filter(({ question }) => normalizeQuestionType(question?.question_type) === type)
    .sort((a, b) => {
      const numberDiff = Number(a.question?.nomor || 0) - Number(b.question?.nomor || 0)
      if (numberDiff !== 0) return numberDiff
      return a.index - b.index
    })
    .map(({ question }) => question)

  return normalizeQuestionNumbering([...sortPart('mcq'), ...sortPart('essay')])
}

export const getQuizEndAt = (quiz) => {
  const mode = normalizeMode(quiz)
  if (mode === 'regular') return safeDate(quiz?.deadline_at)
  const startsAt = safeDate(quiz?.live_started_at || quiz?.starts_at)
  const duration = Number(quiz?.duration_minutes || 0)
  if (!startsAt || duration <= 0) return safeDate(quiz?.deadline_at)
  return new Date(startsAt.getTime() + duration * 60000)
}

export const getRemainingSeconds = (quiz, now) => {
  const endAt = getQuizEndAt(quiz)
  if (!endAt) return null
  return Math.floor((endAt.getTime() - now.getTime()) / 1000)
}

export const getQuizStatus = (quiz, now = new Date()) => {
  const startsAt = safeDate(quiz?.starts_at)
  const endAt = getQuizEndAt(quiz)
  const closedAt = safeDate(quiz?.closed_at)

  if (closedAt) {
    return { label: 'Ditutup', tone: 'bg-red-100 text-red-700 border-red-200', kind: 'expired' }
  }

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

export const getQuizCreatedAtMs = (quiz) => {
  const createdAt = safeDate(quiz?.created_at)
  return createdAt ? createdAt.getTime() : 0
}

export const compareQuizByDeadlineUrgency = (a, b, now = new Date()) => {
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

export const sortQuizzesByPriority = (rows, now = new Date()) => {
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

export const getQuizCountdownMeta = (quiz, status, now = new Date()) => {
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

export const getQuizMutationMeta = (quiz) => {
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

export const getQuizMonthKey = (quiz) => {
  const baseDate = safeDate(quiz?.starts_at || quiz?.deadline_at || quiz?.created_at)
  if (!baseDate) return ''
  const year = baseDate.getFullYear()
  const month = String(baseDate.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export const getMonthKeyFromDate = (dateValue) => {
  const date = safeDate(dateValue)
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export const getLastNMonthKeys = (nowValue = new Date(), count = 12) => {
  const now = safeDate(nowValue) || new Date()
  const set = new Set()
  const base = new Date(now.getFullYear(), now.getMonth(), 1)
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    set.add(getMonthKeyFromDate(d))
  }
  return set
}

export const formatQuizMonthLabel = (monthKey) => {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return String(monthKey || '')
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

export const getViolationTypeLabel = (eventType) => {
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

export const getViolationWarningNumber = (row) => {
  const value = Number(row?.event_meta?.warning_count || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export const getViolationIncidentKey = (row) => {
  const incidentId = String(row?.event_meta?.incident_id || '').trim()
  if (incidentId) return incidentId

  const warningNumber = getViolationWarningNumber(row)
  if (warningNumber > 0) return `warning:${warningNumber}`

  const rowDate = safeDate(row?.created_at)
  if (rowDate) return `legacy:${Math.floor(rowDate.getTime() / 4000)}`

  return String(row?.id || '').trim()
}

export const isCountedViolationType = (eventType) => {
  const type = String(eventType || '').trim().toLowerCase()
  return !['manual_submit_after_warning'].includes(type)
}

export const ONLINE_ACTIVE_SECONDS = 120

