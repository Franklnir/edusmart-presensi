import http from 'k6/http'
import { check, fail, sleep } from 'k6'
import exec from 'k6/execution'

const baseUrl = String(__ENV.BASE_URL || '').replace(/\/+$/, '')
const singleQuizId = String(__ENV.QUIZ_ID || '').trim()
const quizIds = String(__ENV.QUIZ_IDS || '')
  .split(/[,\n]/)
  .map((id) => id.trim())
  .filter(Boolean)
const singleQrToken = String(__ENV.ATTENDANCE_QR_TOKEN || '').trim()
const qrTokens = String(__ENV.ATTENDANCE_QR_TOKENS || '')
  .split(/[,\n]/)
  .map((token) => token.trim())
  .filter(Boolean)
const authTokens = String(__ENV.AUTH_TOKENS || '')
  .split(/[,\n]/)
  .map((token) => token.trim())
  .filter(Boolean)
const allowProduction = String(__ENV.ALLOW_PRODUCTION_LOAD_TEST || '').toLowerCase() === 'true'
const students = Number(__ENV.STUDENTS || authTokens.length || 0)
const quizStartDelay = String(__ENV.QUIZ_START_DELAY || '2m')

if (!baseUrl || (!singleQuizId && !quizIds.length) || (!singleQrToken && !qrTokens.length) || !authTokens.length || students < 1) {
  fail('BASE_URL, QUIZ_ID/QUIZ_IDS, ATTENDANCE_QR_TOKEN/ATTENDANCE_QR_TOKENS, AUTH_TOKENS, dan STUDENTS wajib diisi.')
}

if (authTokens.length < students) {
  fail(`AUTH_TOKENS hanya berisi ${authTokens.length} token, tetapi STUDENTS=${students}.`)
}

if (!singleQrToken && qrTokens.length < students) {
  fail(`ATTENDANCE_QR_TOKENS hanya berisi ${qrTokens.length} token, tetapi STUDENTS=${students}.`)
}

if (!singleQuizId && quizIds.length < students) {
  fail(`QUIZ_IDS hanya berisi ${quizIds.length} ID, tetapi STUDENTS=${students}.`)
}

if (!allowProduction && /(^|\.)sismu\.biz\.id$/i.test(new URL(baseUrl).hostname)) {
  fail('Load test ke production diblokir. Gunakan staging atau isi ALLOW_PRODUCTION_LOAD_TEST=true dengan sadar.')
}

export const options = {
  scenarios: {
    morning_attendance: {
      executor: 'per-vu-iterations',
      exec: 'attendance',
      vus: students,
      iterations: 1,
      maxDuration: '3m',
    },
    midday_quiz: {
      executor: 'per-vu-iterations',
      exec: 'quiz',
      startTime: quizStartDelay,
      vus: students,
      iterations: 1,
      maxDuration: String(__ENV.QUIZ_MAX_DURATION || '15m'),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    'http_req_duration{flow:attendance}': ['p(95)<1200'],
    'http_req_duration{flow:quiz}': ['p(95)<1500'],
  },
}

function studentIndex() {
  return exec.scenario.iterationInTest % students
}

function headersForStudent(index) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authTokens[index]}`,
  }
}

export function attendance() {
  const index = studentIndex()
  const response = http.post(
    `${baseUrl}/api/attendance-qr/scan`,
    JSON.stringify({ token: qrTokens[index] || singleQrToken }),
    { headers: headersForStudent(index), tags: { flow: 'attendance' } },
  )

  check(response, {
    'presensi berhasil': (result) => result.status === 200,
  })
}

export function quiz() {
  const index = studentIndex()
  const quizId = quizIds[index] || singleQuizId
  const headers = headersForStudent(index)
  const tags = { flow: 'quiz' }
  const start = http.post(`${baseUrl}/api/quiz/start`, JSON.stringify({ quiz_id: quizId }), { headers, tags })
  check(start, { 'start attempt berhasil': (response) => response.status === 200 })

  const submissionId = start.json('data.submission.id')
  if (!submissionId) {
    return
  }

  const detail = http.get(`${baseUrl}/api/quiz/${quizId}`, { headers, tags })
  check(detail, { 'detail quiz berhasil': (response) => response.status === 200 })

  const questions = detail.json('data.questions') || []
  const optionsByQuestion = detail.json('data.options_by_question') || {}
  const answers = questions.map((question) => {
    const options = optionsByQuestion[question.id] || []
    return {
      question_id: question.id,
      option_id: options[0]?.id || null,
      essay_answer: String(question.question_type || '').toLowerCase() === 'essay' ? 'Jawaban load test' : null,
    }
  })

  if (answers.length) {
    const save = http.post(`${baseUrl}/api/quiz/answers/batch`, JSON.stringify({
      quiz_id: quizId,
      submission_id: submissionId,
      answers,
    }), { headers, tags })
    check(save, { 'batch jawaban berhasil': (response) => response.status === 200 })
  }

  sleep(Math.random() * 2 + 0.5)

  const submit = http.post(`${baseUrl}/api/quiz/submit`, JSON.stringify({
    quiz_id: quizId,
    submission_id: submissionId,
    answers,
  }), { headers, tags })
  check(submit, { 'submit quiz berhasil': (response) => response.status === 200 })
}
