import http from 'k6/http'
import { check, fail, sleep } from 'k6'

const baseUrl = String(__ENV.BASE_URL || '').replace(/\/+$/, '')
const quizId = String(__ENV.QUIZ_ID || '')
const singleAuthToken = String(__ENV.AUTH_TOKEN || '').trim()
const authTokens = String(__ENV.AUTH_TOKENS || '')
  .split(/[,\n]/)
  .map((token) => token.trim())
  .filter(Boolean)
const allowProduction = String(__ENV.ALLOW_PRODUCTION_LOAD_TEST || '').toLowerCase() === 'true'
const vus = Number(__ENV.VUS || authTokens.length || 1)

if (!baseUrl || !quizId || (!singleAuthToken && !authTokens.length)) {
  fail('BASE_URL, QUIZ_ID, dan AUTH_TOKENS wajib diisi. AUTH_TOKEN hanya boleh dipakai untuk VUS=1.')
}

if (vus > 1 && authTokens.length < vus) {
  fail(`AUTH_TOKENS hanya berisi ${authTokens.length} token, tetapi VUS=${vus}. Siapkan satu token berbeda per siswa virtual.`)
}

if (!allowProduction && /(^|\\.)sismu\\.biz\\.id$/i.test(new URL(baseUrl).hostname)) {
  fail('Load test ke production diblokir. Gunakan staging atau isi ALLOW_PRODUCTION_LOAD_TEST=true dengan sadar.')
}

export const options = {
  scenarios: {
    quiz_students: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: String(__ENV.MAX_DURATION || '10m'),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
  },
}

function headersForVu() {
  const authToken = authTokens[__VU - 1] || singleAuthToken
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  }
}

export default function () {
  const headers = headersForVu()
  const start = http.post(`${baseUrl}/api/quiz/start`, JSON.stringify({ quiz_id: quizId }), { headers })
  check(start, { 'start attempt berhasil': (response) => response.status === 200 })

  const submissionId = start.json('data.submission.id')
  if (!submissionId) {
    sleep(1)
    return
  }

  const detail = http.get(`${baseUrl}/api/quiz/${quizId}`, { headers })
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
    }), { headers })
    check(save, { 'batch jawaban berhasil': (response) => response.status === 200 })
  }

  sleep(Math.random() * 2 + 0.5)

  const submit = http.post(`${baseUrl}/api/quiz/submit`, JSON.stringify({
    quiz_id: quizId,
    submission_id: submissionId,
    answers,
  }), { headers })
  check(submit, { 'submit quiz berhasil': (response) => response.status === 200 })
}
